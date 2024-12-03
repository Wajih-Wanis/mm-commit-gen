// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const {Ollama} = require('@langchain/ollama');
const {ChatOpenAI,AzureChatOpenAI} = require('@lanchain/openai');

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
			const message = await this.model.invoke(input);
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
			const message = this.model.invoke(input);
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
			azureOpenAIDeploymentName:deployment,
		})
	}

	async run(input){
		try{
			const message = await this.model.invoke(input)
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
