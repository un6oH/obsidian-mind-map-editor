import { App, Editor, MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { createEmptyCard, FSRSParameters } from 'ts-fsrs';
import { createMindMapEditorViewPlugin } from 'view-plugins/mind-map-editor-view-plugin';
import { VIEW_TYPE_MIND_MAP, MindMapView } from 'views/mind-map-view';
import { Settings, MindMapLayout, Warning, MapProperties, MapSettings } from 'types';
import { noteTagRegex, mapTagRegex, parseMindMap, parseNoteTag, createNoteProperties, toNoteID, toPathString, noteType, createNoteTag, listIndex, errorTagOpen, errorTagClose, mapTagOpen, mapTagClose, noteTagOpen, errorPattern, parseMapTag, createMapTag, errorRegex, errorTagRegex } from 'helpers';
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

		const proofreadNotesStatusBarItem = this.addStatusBarItem();
		proofreadNotesStatusBarItem.addClass('mod-clickable');
		proofreadNotesStatusBarItem.textContent = "Check notes";
		proofreadNotesStatusBarItem.onclick = () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			console.log("Proofreading document...");
			const library = processDocument(activeView!.editor);
			proofreadNotes(activeView!.editor, library);
			// new ProofreadNotesModal(this.app, activeView!.editor, library.warningLines, library.warnings).open();
		}; 

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
		studyMindMapStatusBarItem.onclick = () => {
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
				proofreadNotesStatusBarItem.show();
				updateNotesStatusBarItem.show();
				studyMindMapStatusBarItem.show();
				studyMindMapStatusBarItem.textContent = `Study ${this.currentMindMapTitle}`;
			} else {
				proofreadNotesStatusBarItem.hide();
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

	async onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

export function updateMapSettings(editor: Editor, settings: MapSettings) {
	const text = editor.getLine(1);
	editor.replaceRange(
		createMapTag(settings), 
		{ line: 1, ch: 0 },
		{ line: 1, ch: text.length },
	)
}

export async function studyNotes(app: App, plugin: MindMapEditorPlugin, editor: Editor) {
	const lineCount = editor.lineCount();
	const from = { line: 0, ch: 0 };
	const to = { line: lineCount - 1, ch: editor.getLine(lineCount - 1).length };
	const mindMap = parseMindMap(editor.getRange(from, to));
	console.log("studyNotes(): mind map parsed: ", mindMap);

	if (!mindMap) {
		new Notice("Mind map not found");
		return;
	}

	const filePath = app.workspace.activeEditor?.file?.path!;
	// console.log(filePath);
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
	await workspace.revealLeaf(leaf)
		.then(() => {
			this.mindMapView = leaf.view as MindMapView;
			this.mindMapView.initialiseMindMap(mindMap, layout, () => saveProgress(editor), (layout: MindMapLayout) => saveLayout(plugin, layout));
		});
}

// stores content, index, and level of every instance of the same content
// ref stores the index of the lowest level (reference) instance
interface noteGroup {
	content: string;
	indices: number[]; // index in note library
	levels: number[]; 
	parentIndex: number | null; // for duplicate relations under the same parent
	ref: number;
}

interface noteLibrary {
	notes: string[]; // content of notes
	lines: number[]; // line number of each note
	levels: number[]; // indent level of each note
	listIndices: number[]; 
  uniqueNotes: noteGroup[];
	warningLines: number[]; // list of line numbers
	warnings: Warning[]; // list of types
}

function processDocument(doc: Editor): noteLibrary {
	const start = 0;
	const end = doc.lineCount();
	
	// generate data to send to syntax tree processor
	const notes: string[] = [];
	const lines: number[] = [];
	const levels: number[] = [];
	const listIndices: number[] = [];
  const uniqueNotes: noteGroup[] = [];
	const warningLines: number[] = []; // lines with associated warning
	const warnings: Warning[] = []; // type of warning

	const listItemRegex = RegExp("^(?<tabs>\t*)(?<list>[0-9]+\. |- )(?<content>.+)"); // finds lines with a list delimiter and content
	// 1: tabs
	// 2: list delimiter; xx. OR -
	// 3: content
	for (let l = start; l < end; l++) { // preprocessor handles duplicates
		const line = doc.getLine(l);
		const match = listItemRegex.exec(line);

		if (!match) {
			if (/# /.exec(line) || mapTagRegex.exec(line)) {
				continue;
			}

			if (line.trim() === "") {
				// console.log(`processDocument() empty line: ${l}`);
				warningLines.push(l);
				warnings.push(Warning.EmptyLine);
				continue;
			} else {
				// console.log(`processDocument() invalid note found at line ${l}:`, line);
				warningLines.push(l);
				warnings.push(Warning.Invalid);
				continue;
			}
		}

		if (match[3].trim() === "") {
			// console.log(`processDocument() empty line: ${l}`);
			warningLines.push(l);
			warnings.push(Warning.EmptyLine);
			continue;
		}

		const level = match[1].length;
		listIndices.push(listIndex(match[2]));

		// remove tags
		let text = match[3];
		let noteTagMatch = noteTagRegex.exec(text) as any;
		if (noteTagMatch) {
			text = text.substring(0, noteTagMatch.indices[0][0]);
		}
		let errorTagMatch = errorTagRegex.exec(text) as any;
		if (errorTagMatch) {
			text = text.substring(0, errorTagMatch.indices[0][0]);
		}
		let note = text.trim();

		const index = notes.push(note) - 1;
		lines.push(l);
		levels.push(level);

		// find duplicates
		let lower = note.toLowerCase();
		if (note.endsWith(":")) { // relations get added to warning list if duplicated
			let parentIndex = index - 1; // index of parent note; -1 if the note has no parent
			if (level == 0) {
				parentIndex = -1;
			} else {
				while (parentIndex >= -1) {
					if (levels[parentIndex] < level) {
						break;
					} else {
						parentIndex--;
					}
				}
			}

			const uniqueIndex = uniqueNotes.findIndex((entry) => entry.content === lower && entry.parentIndex === parentIndex);
			if (uniqueIndex == -1) {
				uniqueNotes.push({
					content: lower, 
					indices: [index], 
					levels: [level], 
					parentIndex: parentIndex,  
					ref: index,
				});
			} else {
				uniqueNotes[uniqueIndex].indices.push(index);
				uniqueNotes[uniqueIndex].levels.push(level);
			}
		} else { // key words link to the lowest level instance
			// console.log("duplicate key word:", note);
			const uniqueIndex = uniqueNotes.findIndex((entry) => entry.content === lower);
		
			if (uniqueIndex == -1) { // no matching notes
				// console.log("unique note:", note);
				uniqueNotes.push({
					content: lower, 
					indices: [index], 
					levels: [level], 
					parentIndex: null,  
					ref: index,
				});
			} else { // matching notes
				const uniqueEntry = uniqueNotes[uniqueIndex];
				// console.log("existing note:", note);
				uniqueNotes[uniqueIndex].indices.push(index);
				uniqueNotes[uniqueIndex].levels.push(level);

				if (levels[uniqueEntry.ref] < level) { // link to lowest level
					uniqueNotes[uniqueIndex].ref = index;
				}
			}
		}
	}
	// console.log("processNotes(): duplicate notes", uniqueNotes.filter((group) => group.indices.length > 1));

	// push duplicate warnings to warnings
	for (let group of uniqueNotes) {
		if (group.indices.length == 1) {
			continue;
		}

		// find link conflicts
		let parents: number[] = [];
		for (let i = 0; i < group.indices.length; i++) {
			const index = group.indices[i];
			const level = group.levels[i];
			if (levels[index + 1] > level) {
				parents.push(index);
				group.ref = index;
				// console.log(`key word ${group.content} level ${level} has child of level ${levels[index + 1]}`)
			}
		}

		for (let i of group.indices) {
			const end = group.content.slice(-1);
			switch (end) {
				case ':': // relations
					warningLines.push(lines[i]);
					warnings.push(Warning.DuplicateRelation);
					break;
				case '*': // unlinked key word
					break;
				default: // key word with conflicts
					if (parents.contains(i) && parents.length > 1) {
						warningLines.push(lines[i]);
						warnings.push(Warning.LinkConflict);
					}
			}
		}
	}

	return {notes, lines, levels, listIndices, uniqueNotes, warningLines, warnings};
}

function proofreadNotes(editor: Editor, library: noteLibrary) {
	dismissWarnings(editor);

	new Notice(`${library.warningLines.length} error(s) found.`);

	const mapTagMatch = editor.getDoc().getLine(1).match(mapTagRegex);
	const crosslink = mapTagMatch ? parseMapTag(mapTagMatch[1]).crosslink : true;

	for (let i = 0; i < library.warningLines.length; i++) {
		const warning = library.warnings[i];
		// ignore duplicate key word warnings if crosslink is disabled
		if (!crosslink && (warning == Warning.DuplicateKeyWord || warning == Warning.LinkConflict)) continue;

		const lineNumber = library.warningLines[i]
		const text = editor.getLine(lineNumber);
		editor.replaceRange(
			`${errorTagOpen}${warning}${errorTagClose}`, 
			{ line: lineNumber, ch: text.length }
		);
	}
}

export function dismissWarnings(editor: Editor) {
	const doc = editor.getDoc();
	const lineCount = doc.lineCount();
	const errorTagRegex = RegExp(errorPattern, 'd')
	for (let l = lineCount - 1; l >= 0; l--) {
		const line = doc.getLine(l);
		const match = errorTagRegex.exec(line);

		if (!match) continue;

		const indices: number[][] = (match as any).indices;
		const start = indices[1][0];
		const end = indices[1][2];

		editor.replaceRange("", 
			{ line: l, ch: start },
			{ line: l, ch: end }
		);
	}

	// console.log("dismissWarnings(): Dismissed all warnings");
}

export function updateNotes(editor: Editor, proofread: boolean, linkSimilar: boolean, title: string) {
	const doc = editor.getDoc();
	const library = processDocument(doc);
	if (proofread && library.warningLines.length != 0) {
		new Notice("Unresolved warnings - fix notes");
		proofreadNotes(editor, library);
		return;
	}

	// recursively iterates through list to generate a list of paths
	const titleID = toNoteID(title, false);
	const paths = noteTree(library.notes, library.levels, []);
	// console.log("updateNotes(): parsed note tree. paths:", paths);

	// update the props tag for each note
	for (let i = 0; i < library.lines.length; i++) {
		const note = library.notes[i];
		const line = library.lines[i];
		const path = paths[i];
		const listIndex = library.listIndices[i];
		const text = doc.getLine(line);
		
		const type = noteType(note);
		const study = type.study;

		// set the id
		let id = null;
		if (type.keyWord) { // key words all link to the reference (if linking is enabled)
			const independent = note.endsWith('*');
			if (linkSimilar && !independent) { // if link similar is enabled, find the id of the reference note
				const uniqueEntry = library.uniqueNotes.find(entry => entry.content === note.toLowerCase());
				if (uniqueEntry!.indices.length > 1) {
					const ref = uniqueEntry!.ref;
					console.log("path:", path, "ref:", paths[ref], independent);
					id = toPathString(paths[ref]);
				}
			}
		} else { // relations always link to identical siblings
			const uniqueEntry = library.uniqueNotes.find(entry => entry.content === note.toLowerCase() && entry.indices.contains(i));
			if (uniqueEntry!.indices.length > 1) {
				const ref = uniqueEntry!.ref;
				// console.log("path:", path, "ref: ", paths[ref]);
				id = toPathString(paths[ref]);
			}
		}
		
		// update the tag
		const tagMatch = noteTagRegex.exec(text);
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
			// console.log(props.path.last());
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

	console.log(`updateNotes(): updated ${library.notes.length} notes`);
}

// input: array of note content and associated line number and indent level
// initially called under the mind map title
function noteTree(notes: string[], levels: number[], path: string[]): string[][] {
	// get indices of lines of immediate children
	const minLevelIndices: number[] = [];
	for (let i = 0; i < notes.length; i++) { // iterate over each entry
		if (levels[i] == path.length) {
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
	const titleMatch = /^# (.*)$/m.exec(editor.getLine(0));
	if (titleMatch) {
		title = titleMatch[1];
	}
	if (title === "") { 
		console.log("isMindMap(): title not found");
		return "";
	}

	const tagMatch = mapTagRegex.exec(editor.getLine(1));
	if (tagMatch) {
		console.log("isMindMap(): mind map identified", title);
		return title;
	} else {
		console.log("isMindMap(): tag not found");
		return "";
	}
}

export function addMindMapTag(editor: Editor) {
	const tag = `${mapTagOpen}false;true;false;true;36500;0.9;0.40255,1.18385,3.173,15.69105,7.1949,0.5345,1.4604,0.0046,1.54575,0.1192,1.01925,1.9395,0.11,0.29605,2.2698,0.2315,2.9898,0.51655,0.6621${mapTagClose}`;
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