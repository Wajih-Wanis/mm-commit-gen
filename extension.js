// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const child_process = require('child_process')
const {Ollama} = require('@langchain/ollama');
const {ChatOpenAI,AzureChatOpenAI} = require('@langchain/openai');
const {PromptTemplate} = require('@langchain/core/prompts')
const MAX_TOKENS = 60000;


let isGenerating = false;

const COMMIT_MESSAGE_PROMPT = PromptTemplate.fromTemplate(
	"You are an expert senior programmer, your task now is to read these changes {changes} made to the repository files and write a descriptive commit message for them, the commit message should as concise as possible and only return the commit message"
);
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const disposable = vscode.commands.registerCommand('mm-commit-gen.generate-commit', async () => {
        if (isGenerating) {
            vscode.window.showInformationMessage("Commit message is being generated");
            return;
        }

        try {
            isGenerating = true;
            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (!gitExtension) {
                throw new Error('Git extension is not available.');
            }

            const repositories = gitExtension.getAPI(1).repositories;
            for (let repository of repositories) {
                await generateCommitMessage(repository);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error generating commit message: ${error.message}`);
        } finally {
            isGenerating = false;
        }
    });

    context.subscriptions.push(disposable);
}


async function generateCommitMessage(repository) {
    try {
        const changes = await generateDiff(repository);
        if (!changes) return;

        const modelType = await selectModelType();
        let model;

        switch (modelType) {
            case 'ollama':
                model = await new LocalModel().initialize();
                break;
            case 'openai':
                model = await new OpenaiModel().initialize();
                break;
            case 'azure':
                model = new AzureOpenaiModel(
                    await getAzureConfig('endpoint'),
                    await getAzureConfig('deployment'),
                    await getAzureConfig('apiKey'),
                    await getAzureConfig('apiVersion')
                );
                break;
            default:
                throw new Error('Invalid model type selected');
        }

        const commitMessage = await model.run(changes);
        
        // Update repository input box with generated commit message
        repository.inputBox.value = commitMessage;
        
        vscode.window.showInformationMessage('Commit message generated successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
    }
}



//generates the tracked git changes 
function generateDiff(repository) {
	return new Promise((resolve, reject) => {
	  const folderPath = repository.rootUri.fsPath;
	  child_process.exec('git diff --cached', { cwd: folderPath }, (error, stdout, stderr) => {
		if (error) {
		  console.error(`exec error: ${error}`);
		  vscode.window.showErrorMessage(`Error generating diff: ${error}`);
		  reject(error);
		  return;
		}
  
		const changes = stdout;
		console.log(`Changes since last commit:\n${changes}`);
  
		if (changes.trim().length === 0) {
		  vscode.window.showInformationMessage('No changes to commit.');
		  resolve();
		} else {
		  vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Generating commit message...',
			cancellable: true // Make the progress notification cancellable
		  }, async (progress, token) => {
			token.onCancellationRequested(() => {
			  console.log("User cancelled the long running operation");
			  reject('Operation cancelled by the user.');
			});
  
			if (estimateTokens(changes) > MAX_TOKENS) {
			  vscode.window.showErrorMessage(`Error generating commit message: Too many changes to commit. Please commit manually.`);
			  reject('Error generating commit message: Too many changes to commit. Please commit manually.');
			  return;
			}
  
			try {
			  await interpretChanges(changes, 1, progress, repository, token);
			  progress.report({ message: 'Commit message generated successfully.' });
			  resolve();
			} catch (err) {
			  console.error(err);
			  reject(err);
			}
		  });
		}
	  });
	});
  }

function estimateTokens(text) {
	return Math.ceil(text.length / 4);
}


//Interpret the changes
function interpretChanges(changes,attempt,progress,repository,token){
	try{
		if (token.isCancellationRequested){
			console.log("Operation cancelled by the user");
			return;
		}
		const model = new LocalModel();

		const commit_message = model.run(changes);	
		console.log("commit message",commit_message)
		return commit_message
	}catch(err){
		console.log("error occured",err)
	}
}

async function selectModelType() {
    const modelType = await vscode.window.showQuickPick([
        'ollama', 
        'openai', 
        'azure'
    ], {
        placeHolder: 'Select the AI model type to generate commit message'
    });
    return modelType;
}


// Utility function to get configuration
async function getConfig(section, prompt) {
    const config = vscode.workspace.getConfiguration('mm-commit-gen');
    let value = config.get(section);

    if (!value) {
        value = await vscode.window.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true
        });

        if (value) {
            await config.update(section, value, vscode.ConfigurationTarget.Global);
        }
    }

    return value;
}


async function getAzureConfig(section) {
    const azureConfigMap = {
        'endpoint': 'Enter Azure OpenAI endpoint',
        'deployment': 'Enter Azure OpenAI deployment name',
        'apiKey': 'Enter Azure OpenAI API key',
        'apiVersion': 'Enter Azure OpenAI API version'
    };

    return await getConfig(`azure.${section}`, azureConfigMap[section]);
}

// Utility function to get Ollama model configuration
async function getOllamaConfig() {
    const config = vscode.workspace.getConfiguration('mm-commit-gen');
    
    // Get or prompt for Ollama model
    let model = config.get('ollama.model');
    if (!model) {
        const availableModels = await getAvailableOllamaModels();
        model = await vscode.window.showQuickPick(availableModels, {
            placeHolder: 'Select an Ollama model',
            title: 'Choose Ollama Model'
        });

        if (model) {
            await config.update('ollama.model', model, vscode.ConfigurationTarget.Global);
        }
    }

    return model;
}

// Retrieve available Ollama models
async function getAvailableOllamaModels() {
    try {
        const { exec } = require('child_process');
        return new Promise((resolve, reject) => {
            exec('ollama list', (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error listing Ollama models: ${error}`);
                    resolve(['llama3', 'mistral', 'gemma']);
                    return;
                }

                // Parse the output to extract model names
                const models = stdout.split('\n')
                    .filter(line => line.trim() && !line.includes('NAME'))
                    .map(line => line.split(/\s+/)[0]);

                resolve(models.length > 0 ? models : ['llama3', 'mistral', 'gemma']);
            });
        });
    } catch (err) {
        console.error('Failed to retrieve Ollama models', err);
        return ['llama3', 'mistral', 'gemma'];
    }
}


// Utility function to get OpenAI configuration
async function getOpenAIConfig() {
    const config = vscode.workspace.getConfiguration('mm-commit-gen');
    
    // Get or prompt for OpenAI API key
    let apiKey = config.get('openai.apiKey');
    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your OpenAI API key',
            placeHolder: 'sk-...',
            ignoreFocusOut: true
        });

        if (apiKey) {
            await config.update('openai.apiKey', apiKey, vscode.ConfigurationTarget.Global);
        }
    }

    // Get or prompt for OpenAI model
    let model = config.get('openai.model');
    if (!model) {
        model = await vscode.window.showQuickPick([
            'gpt-3.5-turbo',
            'gpt-3.5-turbo-16k',
            'gpt-4',
            'gpt-4-turbo',
            'gpt-4o'
        ], {
            placeHolder: 'Select an OpenAI model',
            title: 'Choose OpenAI Model'
        });

        if (model) {
            await config.update('openai.model', model, vscode.ConfigurationTarget.Global);
        }
    }

    return { apiKey, model };
}


//abstract class model to interface model calling 
class Model{
	run(){
		console.log('Running the interface invoke')
	}
}


//class to run local model with ollama
class LocalModel extends Model {
    constructor() {
        super();
        this.modelName = null;
    }

    async initialize() {
        this.modelName = await getOllamaConfig() || 'llama3';
        this.model = new Ollama({
            model: this.modelName,
        });
        return this;
    }

    async run(input) {
        try {
            if (!this.model) {
                await this.initialize();
            }
            let formatted_prompt = await COMMIT_MESSAGE_PROMPT.invoke({changes: input});
            const message = await this.model.invoke(formatted_prompt);
            return message;
        } catch (err) {
            console.error(`Error in Ollama model (${this.modelName}) invocation`, err);
            throw err;
        }
    }
}


//class to run openai models
class OpenaiModel extends Model {
    constructor() {
        super();
        this.model = null;
        this.apiKey = null;
    }

    async initialize() {
        const { apiKey, model } = await getOpenAIConfig();
        this.apiKey = apiKey;
        this.model = new ChatOpenAI({
            model: model,
            temperature: 0.5,
            openAIApiKey: this.apiKey
        });
        return this;
    }

    async run(input) {
        try {
            if (!this.model) {
                await this.initialize();
            }
            let formatted_prompt = await COMMIT_MESSAGE_PROMPT.invoke({changes: input});
            const message = await this.model.invoke(formatted_prompt);
            return message.content;
        } catch (err) {
            console.error(`Error in OpenAI model (${this.model?.modelName}) invocation`, err);
            throw err;
        }
    }
}


//class to run azure openai deployments
class AzureOpenaiModel extends Model{

	constructor(endpoint,deployment,api_key,api_version){
		super();
		this.model = new AzureChatOpenAI({
			temperature: 0.5,
			azureOpenAIApiKey: api_key,
			azureOpenAIApiInstanceName: endpoint,
			azureOpenAIApiVersion:api_version,
			azureOpenAIApiDeploymentName:deployment,
		})
	}

	async run(input){
		try{
			let formatted_prompt = await COMMIT_MESSAGE_PROMPT.invoke({changes:input});
			const message = this.model.invoke(formatted_prompt);
			return message
		}catch(err){
			console.log("error occured",err)
		}
	}
}






// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
