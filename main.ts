import { EditorView } from '@codemirror/view';
import { Text } from '@codemirror/state';
import { App, Editor, editorInfoField, EditorPosition, EditorRange, EditorSelection, MarkdownFileInfo, MarkdownPostProcessorContext, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, WorkspaceLeaf } from 'obsidian';
import { Card, createEmptyCard, FSRSParameters, generatorParameters, State, StateType } from 'ts-fsrs';
import { createMindMapEditorViewPlugin } from 'view-plugins/mind-map-editor-view-plugin';
import { VIEW_TYPE_MIND_MAP, MindMapView } from 'views/mind-map-view';
import { MapProperties, Note, NoteProperties, MindMap } from 'types';
import { notePattern, noteTagPattern, noteTagRegex, mapTagPattern, mapTagRegex, parseCard, parseMindMap, parseNote, parseNoteTag, parseNumberArray, parsePath, parseStudyParameters, createNote, createNoteProperties, studyable, toNoteID, toPathString, formatPath, noteType } from 'helpers';
// Remember to rename these classes and interfaces!

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
	mindMapView: MindMapView;

	async onload() {
		console.log("plugin loaded.");

		await this.loadSettings();

		this.registerEditorExtension([createMindMapEditorViewPlugin(this)]);

		this.registerView(
			VIEW_TYPE_MIND_MAP, 
			(leaf) => new MindMapView(leaf)
		);

		// const updateNotesRibbonIcon = this.addRibbonIcon('list-checks', "Update notes", () => {
		// 	const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 	if (!activeView) {
		// 		new Notice("No active editor");
		// 		return;
		// 	}
		// 	new UpdateNotesModal(this.app, activeView.editor);
		// });
		// updateNotesRibbonIcon.addClass('my-plugin-ribbon-class');

		// // This creates an icon in the left ribbon.
		// const studyNotesRibbonIcon = this.addRibbonIcon('book-open-check', 'Study mind map', () => {
		// 	// Called when the user clicks the icon.
		// 	this.activateView();
		// });
		// // Perform additional things with the ribbon
		// studyNotesRibbonIcon.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const updateNotesStatusBarItem = this.addStatusBarItem();
		updateNotesStatusBarItem.addClass('mod-clickable');
		updateNotesStatusBarItem.textContent = "Update notes";
		updateNotesStatusBarItem.onclick = () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			console.log("Notes updated");
			new UpdateNotesModal(this.app, activeView!.editor).open();
		};
		
		const studyMindMapStatusBarItem = this.addStatusBarItem();
		studyMindMapStatusBarItem.addClass('mod-clickable');
		studyMindMapStatusBarItem.textContent = "Study notes";
		studyMindMapStatusBarItem.onclick = (ev) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			new StudyNotesModal(this.app, activeView!.editor).open();
		}

		const cursorIndexStatusBarItem = this.addStatusBarItem();
		cursorIndexStatusBarItem.addClass('mod-clickable');
		cursorIndexStatusBarItem.textContent = "Cursor at:";
		
		// trigger status bar items to show 
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			const leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (leaf && isMindMap(leaf.editor)) {
				updateNotesStatusBarItem.show();
				studyMindMapStatusBarItem.show();
			} else {
				updateNotesStatusBarItem.hide();
				studyMindMapStatusBarItem.hide();
			}
		}));

		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			const cursorPosition = editor?.getCursor('head');
			cursorIndexStatusBarItem.textContent = `Cursor at: ${cursorPosition?.line}, ${cursorPosition?.ch}`;
		});

		// Add a command to create a mindmap template
		this.addCommand({
			id: 'mindmapeditor-create-mindmap-template', 
			name: 'Create new mind map', 
			editorCallback: (editor: Editor) => {
				new MindMapCreatorModal(this.app, editor.getSelection(), (text) => {
					editor.replaceSelection(text);
				}).open();
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
			editorCallback: (editor: Editor) => {
				if (isMindMap(editor)) {
					new UpdateNotesModal(this.app, editor).open();
				} else {
					new Notice("This document is not a mind map!");
				}
			}
		});

		this.addCommand({
			id: 'mindmapeditor-get-cursor-index', 
			name: 'Get cursor index', 
			editorCallback: (editor: Editor) => {
				if (isMindMap(editor)) {
					const cursorPosition = editor.getCursor();
					let nCharacters = 0;
					for (let l = cursorPosition.line - 1; l >= 0; l--) {
						nCharacters += editor.getLine(l).length;
					}
					console.log("cursor index:", nCharacters + cursorPosition.ch);
				} else {
					new Notice("Not in an editor.");
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			// console.log('click', evt);
		});

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

async function studyNotes(app: App, editor: Editor) {
	const lineCount = editor.lineCount();
	const from = { line: 0, ch: 0 };
	const to = { line: lineCount - 1, ch: editor.getLine(lineCount - 1).length };
	const mindMap = parseMindMap(editor.getRange(from, to));

	if (!mindMap) {
		new Notice("Mind map not found");
		return;
	}

	const { workspace } = app;

	let leaf: WorkspaceLeaf | null = null;
	const leaves = workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP);

	if (leaves.length > 0) {
		// A leaf with our view already exists, use that
		leaf = leaves[0];
	} else {
		// Our view could not be found in the workspace, create a new leaf
		leaf = workspace.getLeaf('window');
		await leaf.setViewState({ type: VIEW_TYPE_MIND_MAP, active: true });
	}

	// "Reveal" the leaf in case it is in a collapsed sidebar
	workspace.revealLeaf(leaf);

	this.mindMapView = leaf.view as MindMapView;
	this.mindMapView.createMindMap(mindMap);
}

// editorCallback for update notes command
// things that can change:
// new note
// changed path
// changed studyable status
interface similarNotes {
	content: string;
	indices: number[];
	levels: number[]; 
	parent: number | null;
	ref: number;
}
function updateNotes(editor: Editor, linkSimilar: boolean) {
	const doc = editor.getDoc();
	const start = 0;
	const end = doc.lineCount();
	
	new Notice("Updated mind map");
	
	// generate data to send to syntax tree processor
	const notes: string[] = [];
	const lines: number[] = [];
	const levels: number[] = [];
	// stores content, index, and level of every instance of the same content
	// ref stores the index of the lowest level (reference) instance
  const uniqueNotes: similarNotes[] = [];
	for (let l = start; l < end; l++) {
		const line = doc.getLine(l);
		if (line.trim().startsWith('- ')) {
			let note = line.trim().substring(2); // row without bullet point
			note = note.split('<note>')[0].trim(); // row without data
			const index = notes.push(note) - 1;
			lines.push(l);
			const tabMatch = line.match(/^\t+/g);
			const level = tabMatch ? tabMatch[0].length : 0
			levels.push(level);

			if (note.endsWith(":")) { // relations link to the first instance of a sibling
				let parent = index - 1; // index of parent note; -1 if note is level 0
				if (level == 0) {
					parent = -1;
				} else {
					while (parent >= 0) {
						if (levels[parent] < level) {
							break;
						} else {
							parent--;
						}
					}
					if (parent < 0) parent = -1;
				}

				const uniqueIndex = uniqueNotes.findIndex((entry) => entry.content === note && entry.parent === parent);
				if (uniqueIndex == -1) {
					uniqueNotes.push({
						content: note, 
						indices: [index], 
						levels: [level], 
						parent: parent,  
						ref: index,
					});
				} else {
					uniqueNotes[uniqueIndex].indices.push(index);
					uniqueNotes[uniqueIndex].levels.push(level);
				}
			} else { // key words link to the lowest level instance
				const uniqueIndex = uniqueNotes.findIndex((entry) => entry.content === note);
			
				if (uniqueIndex == -1) {
					// console.log("unique note:", note);
					uniqueNotes.push({
						content: note, 
						indices: [index], 
						levels: [level], 
						parent: null,  
						ref: index,
					});
				} else {
					const uniqueEntry = uniqueNotes[uniqueIndex];
					// console.log("existing note:", note);
					uniqueNotes[uniqueIndex].indices.push(index);
					uniqueNotes[uniqueIndex].levels.push(level);

					if (levels[uniqueEntry.ref] > level) {
						uniqueNotes[uniqueIndex].ref = index;
					}
				}
			}
		}
	}
	console.log("updateNotes() unique notes:", uniqueNotes);

	// find title
	let mindMapTitle = "untitled";
	const titleRegex = /# (.*)/g;
	for (let line = 0; line < end; line++) {
		let match = titleRegex.exec(doc.getLine(line))
		if (match) {
			// console.log("title match:", match);
			mindMapTitle = match[1];
			break;
		}
	}

	// recursively iterates through list to generate a list of paths
	const paths = noteTree(notes, levels, [toNoteID(mindMapTitle, true)]);

	// update the props tag for each note
	for (let i = 0; i < lines.length; i++) {
		const note = notes[i];
		const line = lines[i];
		const path = paths[i];
		const text = doc.getLine(line);
		
		const type = noteType(note);
		const study = type.study;

		let id = null;
		
		// if link similar is enabled, find the id of the reference note
		if (type.keyWord) { // key words all link to the reference (if linking is enabled)
			if (linkSimilar) {
				const uniqueEntry = uniqueNotes.find(entry => entry.content === note);
				if (uniqueEntry!.indices.length > 1) {
					const ref = uniqueEntry!.ref;
					id = toPathString(paths[ref]);
				}
			}
		} else { // relations always link to siblings
			const uniqueEntry = uniqueNotes.find(entry => entry.content === note && entry.indices.contains(i));
			if (uniqueEntry!.indices.length > 1) {
				const ref = uniqueEntry!.ref;
				id = toPathString(paths[ref]);
			}
		}
		
		const tagMatch = noteTagRegex.exec(text);
		if (tagMatch) { // tag exists; only replace path string and/or id
			const props = parseNoteTag(tagMatch[1]);
			// console.log("note:", note);
			if (!note) continue;

			props.path = paths[i];
			// if the note has an existing id, don't change it
			// relations do not link
			if (!props.id || !type.keyWord) props.id = id;

			if (study) {
				props.study = true;
				props.card = createEmptyCard(Date.now());
			} else {
				props.study = false;
				props.card = null;
			}

			const positionCh = text.indexOf(tagMatch[1]);
			const tagLength = tagMatch[1].length;

			// console.log(line, text, tagMatch, positionCh, tagLength);
			editor.replaceRange(
				createNoteTag(props, false), 
				{ line: line, ch: positionCh }, 
				{ line: line, ch: positionCh + tagLength }
			);
		} else { // add properties tag
			const props = createNoteProperties(study);
			props.path = path;
			props.id = id;
			
			editor.replaceRange(
				" " + createNoteTag(props), 
				{ line: line, ch: text.length }
			);
		}
	}
}



// creates full tag
function createMapTag(params: FSRSParameters, includeTags = true): string {
	let string = "";
	const propStrings = [
		params.enable_fuzz.toString(), 
		params.enable_short_term.toString(), 
		params.maximum_interval.toString(),
		params.request_retention.toString(), 
		params.w.join(','), 
	]
	propStrings.forEach(str => string += str + ';');

	if (includeTags)
		string = "<map>" + string + "</map>";

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

	if (props.study && !props.card) 
		props.card = createEmptyCard();
	if (props.card) {
		const cardPropStrings = [
			props.card.due.toISOString(), 
			props.card.stability.toString(),
			props.card.difficulty.toString(),
			props.card.elapsed_days.toString(),
			props.card.scheduled_days.toString(),
			props.card.reps.toString(),
			props.card.lapses.toString(),
			props.card.state.toString(), 
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

export function isMindMap(editor: Editor) {
	const start = { line: 0, ch: 0 };
	const lineCount = editor.lineCount();
	const end = { line: lineCount - 1, ch: editor.getLine(lineCount - 1).length};
	const text = editor.getRange(start, end);
	for (let l = 0; l < lineCount; l++) {
		const line = editor.getLine(l);
		const tagMatch = mapTagRegex.exec(line);
		if (tagMatch) {
			return true;
		}
	}
}

export function addMindMapTag(editor: Editor) {
	const tag = "<map>false;true;36500;0.9;0.40255,1.18385,3.173,15.69105,7.1949,0.5345,1.4604,0.0046,1.54575,0.1192,1.01925,1.9395,0.11,0.29605,2.2698,0.2315,2.9898,0.51655,0.6621</map>";
	const cursor = editor.getCursor();
	const from = {
		line: cursor.line, 
		ch: editor.getLine(cursor.line).length
	} 
	editor.replaceRange("\n" + tag, from);
}

class MindMapCreatorModal extends Modal {
	constructor(app: App, title: string, editorCallback: (text: string) => void) {
		super(app);

		this.setTitle("Create a mind map");
		const map: MapProperties = {
			title: title ? title : "My mind map",
			id: 'id', 
			studySettings: generatorParameters()
		}
		new Setting(this.contentEl)
			.setName("Title")
			.addText((text) => text
				.setPlaceholder(map.title)
				.onChange((value) => {
					map.title = value;
					map.id = toNoteID(value, true);
				}));

		new Setting(this.contentEl)
			.setName("Desired retention")
			.addText((text) => text
				.setPlaceholder(map.studySettings.request_retention.toString())
				.onChange((value) => {
					let v = parseFloat(value);
					if (v) map.studySettings.request_retention = v;
				}));
		
		new Setting(this.contentEl)
			.setName("Maximum interval")
			.addText((text) => text
				.setPlaceholder(map.studySettings.maximum_interval.toString())
				.onChange((value) => {
					let v = parseFloat(value);
					if (v) map.studySettings.maximum_interval = v;
				}));

		new Setting(this.contentEl)
			.setName("Parameters")
			.addText((text) => text
				.setPlaceholder(map.studySettings.w.toString())
				.onChange((value) => {
					let v = parseNumberArray(value);
					if (v) map.studySettings.w = v;
				}));

		new Setting(this.contentEl)
			.setName("Enable fuzz")
			.addText((text) => text
				.setPlaceholder(map.studySettings.enable_fuzz.toString())
				.onChange((value) => {
					let v = value === "true";
					if (v) map.studySettings.enable_fuzz = v;
				}));
		
		new Setting(this.contentEl)
			.setName("Enable short term")
			.addText((text) => text
				.setPlaceholder(map.studySettings.enable_short_term.toString())
				.onChange((value) => {
					let v = value === "true";
					if (v) map.studySettings.enable_short_term = v;
				}));

		new Setting(this.contentEl)
			.addButton((btn) => btn
				.setButtonText("Create")
				.setCta()
				.onClick(() => {
					this.close();
					editorCallback("# " + map.title + "\n" + createMapTag(map.studySettings, true));
				})
			)
	}
}

class UpdateNotesModal extends Modal {
	constructor(app: App, editor: Editor) {
		super(app);

		this.setTitle("Update notes");

		const settings = {
			linkSimilar: false, 
		};

		new Setting(this.contentEl)
			.setName("Link all similar notes")
			.addToggle((toggle) => toggle
				.setValue(false)
				.onChange(value => settings.linkSimilar = value));
		
		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText("Dismiss")
				.setCta()
				.onClick(this.close));

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText("Update notes")
				.setCta()
				.onClick(() => {
					updateNotes(editor, settings.linkSimilar);
					this.close();
				}));
	}
}

class StudyNotesModal extends Modal {
	constructor(app: App, editor: Editor) {
		super(app);

		this.setTitle("Study notes");
		
		new Setting(this.contentEl)
			.setName("Update notes")
			.addButton((button) => button
				.setButtonText("Update")
				.setCta()
				.onClick(() => {
					new UpdateNotesModal(app, editor).open();
				}));
		
		new Setting(this.contentEl)
			.setName("Study mind map")
			.addButton((button) => button
				.setButtonText("Let's go!")
				.setCta()
				.onClick(() => {
					studyNotes(app, editor);
					this.close();
				}));
	}
}
export class MapStudySettingsEditorModal extends Modal {
	view: EditorView;

	// start and end of tag
	constructor(plugin: Plugin, view: EditorView, start: number, end: number) {
		// console.log("Created map study settings editor modal", "start:", start, "end:", end);
		super(plugin.app);
		this.view = view;
		
		// parse data string
		this.setTitle("Map study settings");
		const tag = view.state.doc.sliceString(start, end);
		const params = parseStudyParameters(tag);
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
		const tag = createMapTag(params, true);
		// console.log(tag);
		const transaction = this.view.state.update({
			changes: {
				from: from, 
				to: to, 
				insert: tag, 
			}
		});
		this.view.dispatch(transaction);
	}
}

// Called from note widget. Specifies start and end indices of text within widget
export class NotePropertyEditorModal extends Modal {
	view: EditorView;
	indices: number[][];
	note: Note;

	constructor(plugin: Plugin, view: EditorView, indices: number[][]) {
		super(plugin.app);
		this.view = view;
		this.indices = indices;

		const string = view.state.doc.sliceString(indices[0][0], indices[0][1]);
		// console.log(indices);
		// console.log(string);
		let note = parseNote(string);
		if (!note) {
			new Notice("No note found");
			this.close();
			return;
		}
		this.note = note!;

		let title = this.note.content;
		if (this.note.content.endsWith(":")) {
			title = title.substring(0, title.length - 1);
			title = title + " (Relation)"
		} else {
			title = title + " (Key word)";
		}
		
		this.setTitle(title);

		// settings
		new Setting(this.contentEl)
			.setName("Text:")
			.addText((text) => 
				text.setValue(this.note.content.trim()).onChange((value) => {
					this.note.content = value.trim();
					this.note.props.path[this.note.props.path.length - 1] = toNoteID(value);
				}))
			.setDesc("Warning: changing this note's contents may disconnect linked notes");

		// displays path
		new Setting(this.contentEl)
      .setName('Path')
      .setDesc(formatPath(this.note.props.path));

		// opens a suggest modal to select notes
		const idDescription = document.createDocumentFragment();
		const idDescriptionSpan = document.createElement('span');
		idDescriptionSpan.textContent = this.note.props.id ? this.note.props.id.replace(/\\/g, ' > ') : "not linked";
		idDescription.appendChild(idDescriptionSpan);
		new Setting(this.contentEl)
			.setName("ID")
			.addButton((button) => button
				.setButtonText("Find a note")
				.setCta()
				.onClick(() => {
					new IdSuggestModal(plugin.app, view, this.note.content, (id: string) => {
						this.note.props.id = id;
						idDescriptionSpan.textContent = id.replace(/\\/g, ' > ');
						// console.log("id linked to", id);
					}).open();
				}))
			.addButton((button) => button
				.setButtonText("Unlink")
				.setCta()
				.onClick(() => {
					this.note.props.id = null;
					idDescriptionSpan.textContent = "not linked";
					// console.log("id unlinked");
				}))
			.setDesc(idDescription);
		
		// toggle to select studyable
		new Setting(this.contentEl)
			.setName('Studyable')
			.addToggle((toggle) => toggle
				.setValue(this.note.props.study)
				.onChange((value) => this.note.props.study = value));

		// card params
		const card = this.note.props.card!;
		if (this.note.props.card != null) {
			new Setting(this.contentEl)
				.setName('Card due date (can edit)')
				.addText((text) =>
					text.setValue(card.due.toString()).onChange((value) => {
						let newDate = new Date(value);
						card.due = newDate.valueOf() ? newDate : card.due;
					}));
			new Setting(this.contentEl)
				.setName('Card stability')
				.addText((text) =>
					text.setPlaceholder(card.stability.toString()).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card difficulty')
				.addText((text) =>
					text.setPlaceholder(card.difficulty.toString()).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card elapsed days')
				.addText((text) =>
					text.setPlaceholder(card.elapsed_days.toString()).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card scheduled days')
				.addText((text) =>
					text.setPlaceholder(card.scheduled_days.toString()).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card reps')
				.addText((text) =>
					text.setPlaceholder(card.reps.toString()).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card lapses')
				.addText((text) =>
					text.setPlaceholder(card.lapses.toString()).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card state')
				.addText((text) =>
					text.setPlaceholder(State[card.state]).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card last review')
				.addText((text) =>
					text.setPlaceholder(card.last_review ? card.last_review.toString() : "not reviewed yet").setDisabled(true));
		}
		
		new Setting(this.contentEl)
		.addButton((btn) => {
			btn
				.setButtonText('OK')
				.setCta()
				.onClick(() => {
					this.note.props.card = card;
					this.close();
					this.updateData(indices);
				})
		});
		return;
	}

	updateData(indices: number[][]) {
		const contentEdit = this.view.state.update({
			changes: {
				from: indices[1][0], 
				to: indices[1][1], 
				insert: this.note.content.trim() + " ", 
			}
		});

		const propsEdit = this.view.state.update({
			changes: {
				from: indices[2][0], 
				to: indices[2][1], 
				insert: createNoteTag(this.note.props, false), 
			}
		});
		this.view.dispatch(contentEdit, propsEdit);
	}

	setID(id: string) {
		// console.log(this.note.props.id);
		console.log(id);
		// this.note.props.id = id;
	}
}

interface ID {
	content: string, 
	path: string[]
};
class IdSuggestModal extends SuggestModal<ID> {
	callback: (id: string) => void;
	text: string;
	notes: ID[];
	defaultQuery: string;

	constructor(app: App, view: EditorView, defaultQuery: string, callback: (id: string) => void) {
		super(app)
		this.callback = callback;
		this.text = view.state.doc.toString();
		this.notes = [];
		this.defaultQuery = defaultQuery;

		let noteMatch;
		// split match into 
		const noteRegex = RegExp(notePattern, 'gm');
		while ((noteMatch = noteRegex.exec(this.text)) !== null) {
			// console.log(noteMatch);
			const content = noteMatch[1].trim();

			const propStrings = noteMatch[2].split(';');
			const path = parsePath(propStrings[0]);
			this.notes.push({ content, path });
		}
	}

	getSuggestions(query: string): ID[] | Promise<ID[]> {
		let q = query ? query : this.defaultQuery;
		q = q.toLowerCase();
		return this.notes.filter((note) => note.content.toLowerCase().includes(q));
	}

	renderSuggestion(note: ID, el: HTMLElement): void {
		el.createEl('div', { text: note.content });
		el.createEl('small', { text: formatPath(note.path) });
	}

	onChooseSuggestion(note: ID, evt: MouseEvent | KeyboardEvent): void {
		this.callback(toPathString(note.path));
		this.close();
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
