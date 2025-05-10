import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { create } from 'domain';
import { App, Editor, editorInfoField, EditorPosition, EditorRange, EditorSelection, MarkdownPostProcessorContext, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal } from 'obsidian';
import { decorationSetField } from 'state-fields/decoration-set-field';
import { Card, createEmptyCard, FSRSParameters, generatorParameters, State, StateType } from 'ts-fsrs';
import { createMindMapEditorViewPlugin } from 'view-plugins/mind-map-editor-view-plugin';
// Remember to rename these classes and interfaces!

const mindMapTemplate = `\`\`\`mindmap
# Untitled Mind Map
<map>false;true;36500;0.9;0.40255,1.18385,3.173,15.69105,7.1949,0.5345,1.4604,0.0046,1.54575,0.1192,1.01925,1.9395,0.11,0.29605,2.2698,0.2315,2.9898,0.51655,0.6621;</map>
- note
\`\`\``;

const ALL_EMOJIS: Record<string, string> = {
  ':+1:': '👍',
  ':sunglasses:': '😎',
  ':smile:': '😄',
};
interface Map {
  title: string, 
  studySettings: FSRSParameters, 
}

interface NoteProperties {
	path: string[], // all parents
	id: string | null, // id of node if linked to another branch. node defaults to path if null
	study: boolean, // whether the node can be studied
	card: Card | null, // null if the node is not studyable
}
function createNoteProperties(study: boolean): NoteProperties {
	return {
		path: [], 
		id: null, 
		study: study, 
		card: study ? createEmptyCard(Date.now()) : null, 
	}
}

interface Note {
	content: string, // full content in markdown
	props: NoteProperties, 
}
function createNote(study = false): Note {
	return {
		content: "", 
		props: createNoteProperties(study), 
	}
}

interface MyPluginSettings {
	mySetting: string;
	hideMetadata: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	hideMetadata: true, 
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		console.log("plugin loaded.");

		await this.loadSettings();

		this.registerEditorExtension([createMindMapEditorViewPlugin(this)]);

		// mind map code block processor
		this.registerMarkdownCodeBlockProcessor('mindmap', mindMapCodeBlockProcessor);

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// Add a command to create a mindmap template
		this.addCommand({
			id: 'mindmapeditor-create-mindmap-template', 
			name: 'Create new mind map', 
			editorCallback: (editor: Editor) => {
				const cursor = editor.getCursor();
				editor.replaceRange(mindMapTemplate, cursor);
				editor.setCursor(cursor.line + 1, cursor.ch);
			}
		});

		// Add a command to insert a mind map tag under the selected line
		this.addCommand({
			id: 'mindmapeditor-add-mind-map-tag', 
			name: 'Add mind map tag', 
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'm' }],
			editorCallback: addMindMapTag
		});

		// Add a command to insert a mind map tag under the selected line
		// this.addCommand({
		// 	id: 'mindmapeditor-create-mind-map', 
		// 	name: 'Create mind map from selection', 
		// 	editorCallback: createMindMap
		// });

		// analyses the selected map for nodes to add or update
		this.addCommand({
			id: 'mindmapeditor-update-notes', 
			name: 'Update notes', 
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'u' }],
			editorCallback: updateNotes
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

function addMindMapTag(editor: Editor) {
	const tag = "<map>false;true;36500;0.9;0.40255,1.18385,3.173,15.69105,7.1949,0.5345,1.4604,0.0046,1.54575,0.1192,1.01925,1.9395,0.11,0.29605,2.2698,0.2315,2.9898,0.51655,0.6621</map>";
	const cursor = editor.getCursor();
	const from = {
		line: cursor.line, 
		ch: editor.getLine(cursor.line).length
	} 
	editor.replaceRange("\n" + tag, from);
}

function orderSelection(selection: EditorSelection): {start: EditorPosition, end: EditorPosition} {
	const anchor = selection.anchor;
	const head = selection.head;
	let reverse = false;
	if (anchor.line > head.line) {
		reverse = true;
	} else if (anchor.line == head.line) {
		reverse = anchor.ch > head.ch;
	}
	return reverse ? {start: head, end: anchor} : {start: anchor, end: head};
}

// editorCallback for update notes command
// things that can change:
// new note
// changed path
// changed studyable status
function updateNotes(editor: Editor, view: MarkdownView) {
	// check if cursor is within a mind map
	const doc = editor.getDoc();
	let range = mindMapRange(doc);
	if (!range) {
		new Notice("Select a Mind Map to update");
		return;
	}
	// generate data to send to syntax tree processor
	const { start, end } = range;

	new Notice("Mind map found in lines " + (start + 1) + " to " + (end + 1));

	const notes: string[] = [];
	const lines: number[] = [];
	const levels: number[] = [];
	for (let l = start; l < end; l++) {
		const line = doc.getLine(l);
		if (line.trim().startsWith('- ')) {
			let note = line.trim().substring(2); // row without bullet point
			note = note.split('<note>')[0].trim(); // row without data
			notes.push(note);
			lines.push(l);
			const tabMatch = line.match(/^\t+/g);
			levels.push(tabMatch ? tabMatch[0].length : 0);
		}
	}
	// console.log(levels);

	// update
	const mindMapTopic = doc.getLine(start + 1).substring(1);
	const tree = noteTree(notes, levels, [toNoteID(mindMapTopic, true)]);
	// console.log(tree);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const path = tree[i];
		const text = doc.getLine(line);
		const propertyString = noteTagRegex.test(text);
		// console.log("contains property string:", propertyString);
		
		const study = studyable(notes[i]);

		if (propertyString) { // only replace path string in existing tag
			const note = parseNote(text);
			// console.log("note:", note);
			if (!note) continue;

			let replaceProps = false;
			// console.log("new path:", path, "current path:", note.props.path);
			if (toPathString(path) !== toPathString(note.props.path)) {
				note.props.path = path;
				replaceProps = true;
			}
			if (study != note.props.study) {
				replaceProps = true;
				if (study) {
					note.props.study = true;
					note.props.card = createEmptyCard(Date.now());
				} else {
					note.props.study = false;
					note.props.card = null;
				}
			}

			if (replaceProps) {
				const propsTag = noteTagRegex.exec(text);
				const positionCh = text.search(noteTagRegex);
				const tagLength = propsTag![0].length;

				editor.replaceRange(
					createNoteTag(note.props), 
					{ line: line, ch: positionCh }, 
					{ line: line, ch: positionCh + tagLength }
				)
			}
		} else { // add properties tag
			const props = createNoteProperties(study);
			props.path = path;
			
			editor.replaceRange(
				" " + createNoteTag(props), 
				{ line: line, ch: text.length }
			);
		}
	}
}

export function mindMapRange(doc: Editor): {start: number, end: number} | null {
	const cursor = doc.getCursor().line;
	let start = cursor;
	let end = cursor;

	while (start > -1) {
		const text = doc.getLine(start).trim();
		if (text.startsWith('```mindmap')) break;
		if (text.contains('```') && !text.contains('mindmap')) return null;
		start--; 
	} 
	while (end < doc.lineCount()) {
		const text = doc.getLine(end).trim();
		if (text.startsWith('```') && !text.contains('mindmap')) break;
		if (text.startsWith('```mindmap')) return null;
		end++; 
	} 

	if (start < 0 || end > doc.lineCount()) {
		return null;
	}
	return {start, end};
}

async function mindMapCodeBlockProcessor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
	const rows = source.split('\n').filter((row) => row.length > 0);
	const map: Map = {
		title: "", 
		studySettings: generatorParameters(), 
	};
	
	// find map title
	for (let row of rows) {
		const text = row.trim();
		if (text[0] === "#") {
			map.title = text.substring(1, text.length).trim();
			// console.log("title found:", mapData.title);
			break;
		}
	}

	// find map parameters
	for (let row of rows) {
		const text = row.trim();
		const match = mapTagRegex.exec(text);
		if (match) {
			// map.studySettings = parseStudyParameters(match[1]);
			break;
		}
	}

	// find map nodes
	for (let row of rows) {
		
	}

	el.createEl('div', { text: "Mind map: " + map.title });
}

function parseStudyParameters(string: string): FSRSParameters {
	const parameters = string.trim().split(';');
	const props: Partial<FSRSParameters> = {
		enable_fuzz: parameters[0] !== "" ? parameters[0] === "true" : undefined, 
		enable_short_term: parameters[1] !== "" ? parameters[1] === "true" : undefined, 
		maximum_interval: parameters[2] !== "" ? parseFloat(parameters[2]) : undefined, 
		request_retention: parameters[3] !== "" ? parseFloat(parameters[3]) : undefined, 
		w: parameters[4] !== "" ? parseNumberArray(parameters[4]) : undefined, 
	};
	return generatorParameters(props);
}

// parse note entry
// any line starting with "- "
// return note with assigned properties
function parseNote(str: string): Note | null {
	const string = str.trim();
	const propsTag = noteTagRegex.exec(string);
	// console.log("propsTag:", propsTag ? propsTag : noteDataRegex.exec(string));
	if (!propsTag) {
		return null;
	}

	const note = createNote(false); 
	
	// extract the content string from the line
	const content = /- \s*(.*?)\s*<note>/.exec(string);
	note.content = content ? content[1] : "blank note";

	// parse the props string
	note.props = parseNoteTag(propsTag[1]);
	return note;
}

function parseNoteTag(str: string): NoteProperties {
	const properties = createNoteProperties(true);
	const props = str.split(';');
	
	properties.path = parsePath(props[0]);
	properties.id = props[1] ? props[1] : null;
	properties.study = props[2] === "true";
	properties.card = properties.study ? parseCard(props.slice(3)) : null;

	return properties;
}

function parsePath(str: string): string[] {
	return str.split('\\');
}

function parseCard(props: string[]): Card {
	return {
		due: new Date(props[0]),
    stability: parseFloat(props[1]),
    difficulty: parseFloat(props[2]),
    elapsed_days: parseFloat(props[3]),
    scheduled_days: parseFloat(props[4]),
    reps: parseFloat(props[5]),
    lapses: parseFloat(props[6]),
    state: State[props[7] as StateType],
    last_review: props[8] ? new Date(props[8]) : undefined,
	}
}

function studyable(content: string): boolean {
	const isRelation = /:$/.exec(content) != null; // content ends with ":"
	const containsClozes = /{.+?}/.exec(content) != null; // content includes clozes
	return !isRelation || containsClozes;
}

function toNoteID(str: string, title: boolean = false): string {
	const alphaNumeric = str.replace(/[^a-zA-Z0-9]/g, ''); 
	const lowercase = alphaNumeric.toLowerCase();
	if (title) {
		return lowercase;
	}
	return lowercase.substring(0, 12);
}

function toPathString(path: string[]) {
	return path.join('\\');
}

function createMapTag(params: FSRSParameters): string {
	let string = "";
	const propStrings = [
		params.enable_fuzz.toString(), 
		params.enable_short_term.toString(), 
		params.maximum_interval.toString(),
		params.request_retention.toString(), 
		params.w.join(','), 
	]
	propStrings.forEach(str => string += str + ';');

	return string;
}

function createNoteTag(props: NoteProperties, includeTags = true): string {
	let string = includeTags ? "<note>" : "";
	const propStrings = [
		toPathString(props.path), 
		props.id ? props.id : "", 
		String(props.study), 
	]
	propStrings.forEach(str => string += str + ';');

	if (props.card) {
		const cardPropStrings = [
			props.card.due.toISOString(), 
			props.card.stability.toString(),
			props.card.difficulty.toString(),
			props.card.elapsed_days.toString(),
			props.card.scheduled_days.toString(),
			props.card.reps.toString(),
			props.card.lapses.toString(),
			State[props.card.state], 
			props.card.last_review ? props.card.last_review.toISOString() : ""
		];
		cardPropStrings.forEach(str => string += str + ';');
	}

	string += includeTags ? "</note>" : "";
	return string;
}

// input: array of note content and associated line number and indent level
// initially called under the mind map title
function noteTree(notes: string[], levels: number[], path: string[]): string[][] {
	// get indices of lines of immediate children
	const minLevelIndices: number[] = [];
	for (let i = 0; i < notes.length; i++) { // iterate over each entry
		if (levels[i] == path.length - 1) {
			minLevelIndices.push(i); // add index of immediate child
			// console.log(notes[i], i);
		}
	}
	minLevelIndices.push(notes.length);

	// iterate over immediate children
	let paths: string[][] = []; // path accumulator
	for (let index = 0; index < minLevelIndices.length - 1; index++) {
		const i = minLevelIndices[index];
		let self = toNoteID(notes[i]); // reduce to first 12 characters
		let newPath = path.concat(self);
		paths.push(newPath);
		// console.log("added new path", newPath);
		// indices of slice to pass into next recursion
		let start = i + 1; 
		let end = minLevelIndices[index + 1];
		paths.push(...noteTree(notes.slice(start, end), levels.slice(start, end), newPath));
	}

	return paths;
}

function parseNumberArray(array: string): number[] {
	const splitString = array.split(',');
	return splitString.map((str) => parseFloat(str));
}

export class MapStudySettingsEditorModal extends Modal {
	view: EditorView;

	constructor(plugin: Plugin, view: EditorView, start: number, end: number) {
		super(plugin.app);
		this.view = view;
		
		// parse data string
		this.setTitle("Map study settings");
		const content = view.state.doc.sliceString(start, end);
		const params = parseStudyParameters(content);
		new Setting(this.contentEl)
      .setName('Enable fuzz')
      .addText((text) =>
				text.setPlaceholder(params.enable_fuzz.toString()).onChange((value) => {
          params.enable_fuzz = value === 'true';
        }));
		new Setting(this.contentEl)
			.setName('Enable short term')
			.addText((text) =>
				text.setPlaceholder(params.enable_short_term.toString()).onChange((value) => {
					params.enable_short_term = value === 'true';
				}));
		new Setting(this.contentEl)
			.setName('maximum interval')
			.addText((text) =>
				text.setPlaceholder(params.maximum_interval.toString()).onChange((value) => {
					params.maximum_interval = parseFloat(value);
				}));
		new Setting(this.contentEl)
			.setName('Request retention')
			.addText((text) =>
				text.setPlaceholder(params.request_retention.toString()).onChange((value) => {
					params.request_retention = parseFloat(value);
				}));
		new Setting(this.contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('OK')
					.setCta()
					.onClick(() => {
						this.close();
						this.updateData(params, start, end);
					})
			});
	}

	updateData(params: FSRSParameters, from: number, to: number) {
		const transaction = this.view.state.update({
			changes: {
				from: from, 
				to: to, 
				insert: createMapTag(params), 
			}
		});
		this.view.dispatch(transaction);
	}
}

export class NotePropertyEditorModal extends Modal {
	view: EditorView;

	constructor(plugin: Plugin, view: EditorView, start: number, end: number) {
		super(plugin.app);
		this.view = view;
		
		// parse data string
		this.setTitle("Note properties");
		const propsText = view.state.doc.sliceString(start, end);
		const props = parseNoteTag(propsText);

		new Setting(this.contentEl)
      .setName('Path')
      .addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
          props.path = parsePath(value);
        }));
		new Setting(this.contentEl)
			.setName('id')
			.addText((text) =>
				text.setPlaceholder(props.id ? props.id : 'not linked').onChange((value) => {
					props.id = value;
				}));
		new Setting(this.contentEl)
			.setName('Studyable')
			.addText((text) =>
				text.setPlaceholder(props.study.toString()).onChange((value) => {
					props.study = (value === 'true' || value === 'false') ? value === 'true' : props.study;
				}));

		// card params
		if (!props.card) {
			new Setting(this.contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('OK')
					.setCta()
					.onClick(() => {
						this.close();
						this.updateData(props, start, end);
					})
			});
			return;
		};
		new Setting(this.contentEl)
			.setName('Card due date')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.card.due = Date.parse(value);
				}));
		new Setting(this.contentEl)
			.setName('Card stability')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}).setDisabled(true));
		new Setting(this.contentEl)
			.setName('Card difficulty')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}).setDisabled(true));
		new Setting(this.contentEl)
			.setName('Card elapsed days')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}));
		new Setting(this.contentEl)
			.setName('Card scheduled days')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}));
		new Setting(this.contentEl)
			.setName('Card reps')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}));
		new Setting(this.contentEl)
			.setName('Card lapses')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}));
		new Setting(this.contentEl)
			.setName('Card state')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}));
		new Setting(this.contentEl)
			.setName('Card last review data')
			.addText((text) =>
				text.setPlaceholder(toPathString(props.path)).onChange((value) => {
					props.path = parsePath(value);
				}));
	}

	updateData(props: NoteProperties, from: number, to: number) {
		const transaction = this.view.state.update({
			changes: {
				from: from, 
				to: to, 
				insert: createNoteTag(props, false), 
			}
		});
		this.view.dispatch(transaction);
	}
}

class IdSuggestModal extends SuggestModal<string[]> {
	getSuggestions(query: string): string[][] | Promise<string[][]> {
		
	}

	renderSuggestion(value: string[], el: HTMLElement): void {
		
	}

	onChooseSuggestion(item: string[], evt: MouseEvent | KeyboardEvent): void {
		
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}

export const noteTagPattern = "<note>(.*?)<\/note>";
const noteTagRegex = RegExp(noteTagPattern, 'm');
// export const noteDataRegex = /<note>([\s\S]*?)<\/note>/gm;
// export const mapStudyParametersRegex = /<map>.*?<\/map>/gm;
export const mapTagPattern = "<map>(.*?)<\/map>";
const mapTagRegex = RegExp(mapTagPattern, 'm');