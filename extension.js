// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const child_process = require('child_process')
const {Ollama} = require('@langchain/ollama');
const {ChatOpenAI,AzureChatOpenAI} = require('@langchain/openai');
const {PromptTemplate} = require('@langchain/core/prompts')
const MAX_TOKENS = 60000;

const COMMIT_MESSAGE_PROMPT = PromptTemplate.fromTemplate(
	"You are an expert senior programmer, your task now is to read these changes {changes} made to the repository files and write a descriptive commit message for them"
);
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "mm-commit-gen" is now active!');


	const AI = new LocalModel("llama3.2:1b");
	const ollama_message = AI.run("Is ollama working ? ")
	console.log(ollama_message);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('mm-commit-gen.helloWorld', function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from mm-commit-gen!');
	});

	context.subscriptions.push(disposable);
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

		return commit_message
	}catch(err){
		console.log("error occured",err)
	}
}


//abstract class model to interface model calling 
class Model{
	run(){
		console.log('Running the interface invoke')
	}
}


//class to run local model with ollama
class LocalModel extends Model{
	
	constructor(model_name="llama3"){
		super();
		this.model = new Ollama({
			model: model_name,
		});
	}
	async run(input){
		try{
			let formatted_prompt = await COMMIT_MESSAGE_PROMPT.invoke({changes:input});
			const message = this.model.invoke(formatted_prompt);
			return message;
		}catch(err){
			console.error("Error in local model invokatio",err)
			throw(err)
		}
	}
}


//class to run openai models
class OpenaiModel extends Model{
	
	constructor(model){
		super();
		this.model = new ChatOpenAI({
			model: model,
			temperature: 0.5,
		})
	}

	async run(input){
		try{
			let formatted_prompt = await COMMIT_MESSAGE_PROMPT.invoke({changes:input});
			const message = this.model.invoke(formatted_prompt);
			return message;
		}catch(err){
			console.log("error occured",err)
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
