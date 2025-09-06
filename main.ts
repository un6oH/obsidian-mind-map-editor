import { App, Editor, MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { createEmptyCard } from 'ts-fsrs';
import { createMindMapEditorViewPlugin } from 'view-plugins/mind-map-editor-view-plugin';
import { VIEW_TYPE_MIND_MAP, MindMapView } from 'views/mind-map-view';
import { Settings, MindMapLayout } from 'types';
import { noteTagRegex, mapTagRegex, parseMindMap, parseNoteTag, createNoteProperties, toNoteID, toPathString, noteType, createNoteTag, listIndex } from 'helpers';
import { MindMapCreatorModal, StudyNotesModal, UpdateNotesModal } from 'modals';
// Remember to rename these classes and interfaces!

const DEFAULT_SETTINGS = {
	layouts: [], 
}

export default class MindMapEditorPlugin extends Plugin {
	settings: Settings;
	mindMapView: MindMapView;
	currentMindMapTitle: string;

	async onload() {
		console.log("plugin loaded.");

		await this.loadSettings().then(() => {
			if (this.settings.layouts.length > 0) {
				const paths = this.settings.layouts.map((layout) => layout.path);
				console.log("Loaded saved layouts for:", paths);
			} else {
				console.log("No saved layouts");
			}
		});

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
			this.currentMindMapTitle = isMindMap(activeView!.editor);
			new UpdateNotesModal(this.app, activeView!.editor, this.currentMindMapTitle).open();
		};
		
		const studyMindMapStatusBarItem = this.addStatusBarItem();
		studyMindMapStatusBarItem.addClass('mod-clickable');
		studyMindMapStatusBarItem.textContent = `Study mind map`;
		studyMindMapStatusBarItem.onclick = (_) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			new StudyNotesModal(this.app, this, activeView!.editor, this.currentMindMapTitle).open();
		}

		const cursorIndexStatusBarItem = this.addStatusBarItem();
		cursorIndexStatusBarItem.addClass('mod-clickable');
		cursorIndexStatusBarItem.textContent = "Cursor at:";
		
		// trigger status bar items to show 
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			const leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
			this.currentMindMapTitle = leaf ? isMindMap(leaf.editor) : "";
			if (leaf && this.currentMindMapTitle !== "") {
				updateNotesStatusBarItem.show();
				studyMindMapStatusBarItem.show();
				studyMindMapStatusBarItem.textContent = `Study ${this.currentMindMapTitle}`;
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
				this.currentMindMapTitle = isMindMap(editor);
				if (this.currentMindMapTitle !== "") {
					new UpdateNotesModal(this.app, editor, this.currentMindMapTitle).open();
				} else {
					new Notice("This document is not a mind map!");
				}
			}
		});

		// this.addCommand({
		// 	id: 'mindmapeditor-get-cursor-index', 
		// 	name: 'Get cursor index', 
		// 	editorCallback: (editor: Editor) => {
		// 		if (isMindMap(editor)) {
		// 			const cursorPosition = editor.getCursor();
		// 			let nCharacters = 0;
		// 			for (let l = cursorPosition.line - 1; l >= 0; l--) {
		// 				nCharacters += editor.getLine(l).length;
		// 			}
		// 			console.log("cursor index:", nCharacters + cursorPosition.ch);
		// 		} else {
		// 			new Notice("Not in an editor.");
		// 		}
		// 	}
		// });

		// This adds a settings tab so the user can configure various aspects of the plugin
		// this.addSettingTab(new SampleSettingTab(this.app, this));

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

export async function studyNotes(app: App, plugin: MindMapEditorPlugin, editor: Editor) {
	const lineCount = editor.lineCount();
	const from = { line: 0, ch: 0 };
	const to = { line: lineCount - 1, ch: editor.getLine(lineCount - 1).length };
	const mindMap = parseMindMap(editor.getRange(from, to));

	if (!mindMap) {
		new Notice("Mind map not found");
		return;
	}

	const filePath = app.workspace.activeEditor?.file?.path!;
	console.log(filePath);
	let layoutIndex = plugin.settings.layouts.findIndex((layout) => layout.path === filePath);
	const layout: MindMapLayout = {
		path: filePath, 
		ids: layoutIndex != -1 ? plugin.settings.layouts[layoutIndex].ids : [],
		xCoords: layoutIndex != -1 ? plugin.settings.layouts[layoutIndex].xCoords : [],
		yCoords: layoutIndex != -1 ? plugin.settings.layouts[layoutIndex].yCoords : [], 
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

	this.mindMapView.createMindMap(mindMap, layout, () => saveProgress(editor), (layout: MindMapLayout) => saveLayout(plugin, layout));
}

// stores content, index, and level of every instance of the same content
// ref stores the index of the lowest level (reference) instance
interface noteGroup {
	content: string;
	indices: number[];
	levels: number[]; 
	parent: number | null;
	ref: number;
}

export function updateNotes(editor: Editor, linkSimilar: boolean, title: string) {
	const doc = editor.getDoc();
	const start = 0;
	const end = doc.lineCount();
	
	// generate data to send to syntax tree processor
	const notes: string[] = [];
	const lines: number[] = [];
	const levels: number[] = [];
	const listIndices: number[] = [];
  const uniqueNotes: noteGroup[] = [];

	const listItemRegex = RegExp("^(?<tabs>\t*)(?<list>[0-9]+\.|-)(?<content>.+)");
	for (let l = start; l < end; l++) {
		const line = doc.getLine(l);
		const match = listItemRegex.exec(line);

		if (!match) continue;
		if (match[3].trim() === "") continue;

		const level = match[1].length;
		listIndices.push(listIndex(match[2]));
		let note = match[3].trim();

		const index = notes.push(note) - 1;
		lines.push(l);
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
	// console.log("updateNotes() unique notes:", uniqueNotes);

	// recursively iterates through list to generate a list of paths
	// console.log("updateNotes(): title:", title);
	const titleID = toNoteID(title, false);
	const paths = noteTree(notes, levels, [titleID]);
	// console.log("updateNotes(): parsed note tree. paths:", paths);

	// update the props tag for each note
	for (let i = 0; i < lines.length; i++) {
		const note = notes[i];
		const line = lines[i];
		const path = paths[i];
		const listIndex = listIndices[i];
		const text = doc.getLine(line);
		
		const type = noteType(note);
		const study = type.study;

		// set the id
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
		} else { // relations always link to identical siblings
			const uniqueEntry = uniqueNotes.find(entry => entry.content === note && entry.indices.contains(i));
			if (uniqueEntry!.indices.length > 1) {
				const ref = uniqueEntry!.ref;
				id = toPathString(paths[ref]);
			}
		}
		
		// update the tag
		const tagMatch = /<note>(.*?)<\/note>/.exec(text);
		if (tagMatch) { // tag exists; only replace path string and/or id
			const props = parseNoteTag(tagMatch[1]);
			// console.log("note:", note);
			if (!note) continue;

			// assigning props
			props.path = path;
			// if the note has an existing id, don't change it
			// relations do not link
			if (!props.id || !type.keyWord) props.id = id;
			props.listIndex = listIndex;
			if (study) {
				props.study = true;
				props.card = createEmptyCard(Date.now());
			} else {
				props.study = false;
				props.card = null;
			}

			const positionCh = tagMatch.index
			const tagLength = tagMatch[0].length;
			editor.replaceRange(
				createNoteTag(props, true), 
				{ line: line, ch: positionCh }, 
				{ line: line, ch: positionCh + tagLength }
			);
		} else { // add properties tag
			const props = createNoteProperties(study);
			props.path = path;
			props.id = id;
			props.listIndex = listIndex;
			
			editor.replaceRange(
				" " + createNoteTag(props, true), 
				{ line: line, ch: text.length }
			);
		}
	}

	console.log(`updateNotes(): updated ${notes.length} notes`);
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
		let self = toNoteID(notes[i]); // convert to id
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

export function isMindMap(editor: Editor): string { // returns map title if map setup tags exist
	const lineCount = editor.lineCount();

	let title = "";
	let line = "";
	for (let l = 0; l < lineCount; l++) {
		line = editor.getLine(l);
		const match = /^# (.*)$/m.exec(line);
		if (match) {
			title = match[1];
			break;
		}
	}
	if (title === "") { 
		console.log("isMindMap(): title not found");
		return "";
	}
	let hasTag = false;
	for (let l = 0; l < lineCount; l++) {
		line = editor.getLine(l);
		const match = mapTagRegex.exec(line);
		if (match) {
			hasTag = true;
			break;
		}
	}
	if (hasTag) {
		console.log("isMindMap(): found mind map. title:", title);
		return title;
	} else {
		console.log("isMindMap(): map tag not found");
		return "";
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

async function saveProgress(editor: Editor) {

}

async function saveLayout(plugin: MindMapEditorPlugin, layout: MindMapLayout) {
	const index = plugin.settings.layouts.findIndex((l) => l.path === layout.path);
	if (index != -1) {
		plugin.settings.layouts[index] = layout;
	} else {
		plugin.settings.layouts.push(layout);
		console.log("saveLayout(): added new layout. Saved layouts:", new Array(plugin.settings.layouts.length).fill(0).map((_, i) => plugin.settings.layouts[i].path));
	}
	plugin.saveData(plugin.settings)
		.then(() => console.log("Layout saved:", layout.path))
		.catch((error) => console.log("Could not save layout. Error:", error));
}