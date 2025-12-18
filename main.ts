import { App, Editor, MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { createEmptyCard, FSRSParameters } from 'ts-fsrs';
import { createMindMapEditorViewPlugin } from 'view-plugins/mind-map-editor-view-plugin';
import { VIEW_TYPE_MIND_MAP, MindMapView } from 'views/mind-map-view';
import { Settings, MindMapLayout, Warning, MapProperties, MapSettings, NoteGroup, MindMap } from 'types';
import { noteTagRegex, mapTagRegex, parseMindMap, parseNoteProps, createNoteProperties, toNoteID, toPathString, noteType, createNoteTag, parseListIndex, errorTagOpen, errorTagClose, mapTagOpen, mapTagClose, noteTagOpen, errorPattern, parseMapTag, createMapTag, errorRegex, errorTagRegex, removeTags, idTagRegex, getId, noteRegex, parseNote, createNoteString } from 'helpers';
import { MindMapCreatorModal, StudyMindMapModal, UpdateNotesModal } from 'modals';
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
				// console.log("Loaded saved layouts for:", paths);
			} else {
				// console.log("No saved layouts");
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
			new UpdateNotesModal(this.app, activeView!.editor).open();
		};
		
		const studyMindMapStatusBarItem = this.addStatusBarItem();
		studyMindMapStatusBarItem.addClass('mod-clickable');
		studyMindMapStatusBarItem.textContent = `Study mind map`;
		studyMindMapStatusBarItem.onclick = () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = activeView!.editor;
			const text = activeView!.editor.getRange(
				{ line: 0, ch: 0 }, 
				{ line: editor.lineCount() - 1, ch: editor.lastLine.length }
			);
			const library = processDocument(editor.getDoc());
			if (library.warningLines.length != 0) {
				new Notice("Unresolved warnings - fix notes");
				proofreadNotes(editor, library);
				return;
			}
			const mindMap = parseMindMap(text);
			if (!mindMap) {
				new Notice("Mind map not found.");
				return;
			}

			new StudyMindMapModal(this, editor, mindMap).open();
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

		// analyses the selected map for nodes to add or update
		this.addCommand({
			id: 'mindmapeditor-update-notes', 
			name: 'Update notes', 
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'u' }],
			editorCallback: (editor: Editor) => {
				this.currentMindMapTitle = isMindMap(editor);
				if (this.currentMindMapTitle !== "") {
					new UpdateNotesModal(this.app, editor).open();
				} else {
					new Notice("This document is not a mind map!");
				}
			}
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

export async function studyMindMap(plugin: MindMapEditorPlugin, editor: Editor, mindMap: MindMap) {
	const filePath = plugin.app.workspace.activeEditor?.file?.path!;
	// console.log(filePath);
	let layoutIndex = plugin.settings.layouts.findIndex((layout) => layout.path === filePath);
	const layout: MindMapLayout = {
		path: filePath, 
		ids: layoutIndex != -1 ? plugin.settings.layouts[layoutIndex].ids : [],
		xCoords: layoutIndex != -1 ? plugin.settings.layouts[layoutIndex].xCoords : [],
		yCoords: layoutIndex != -1 ? plugin.settings.layouts[layoutIndex].yCoords : [], 
	}

	const workspace = plugin.app.workspace;

	let leaf: WorkspaceLeaf | null = null;
	const leaves = workspace.getLeavesOfType(VIEW_TYPE_MIND_MAP);

	if (leaves.length > 0) {
		// A leaf with our view already exists, use that
		console.log("studyMindMap() leaf with view exists");
		leaf = leaves[0];
	} else {
		// Our view could not be found in the workspace, create a new leaf
		console.log("studyMindMap() leaf with view does not exist");
		leaf = workspace.getLeaf('window');
		await leaf.setViewState({ type: VIEW_TYPE_MIND_MAP, active: true });
	}

	// "Reveal" the leaf in case it is in a collapsed sidebar
	await workspace.revealLeaf(leaf);
	const view = leaf.view as MindMapView;
	await view.loadGraph(mindMap, layout, () => updateNote(editor), (layout: MindMapLayout) => saveLayout(plugin, layout));
}

interface noteLibrary {
	listIndices: number[]; 
	contents: string[]; // content of notes
	ids: (string | null)[]; // id of notes
	lines: number[]; // line number of each note
	levels: number[]; // indent level of each note
  groups: NoteGroup[];
	warningLines: number[]; // list of line numbers
	warnings: Warning[]; // list of types
}

function processDocument(doc: Editor): noteLibrary {
	// note library properties
	// ensure every valid note is pushed
	const listIndices: number[] = [];
	const contents: string[] = [];
	const ids: (string | null)[] = [];
	const lines: number[] = [];
	const levels: number[] = [];
	// only some notes
  const groups: NoteGroup[] = [];
	const warningLines: number[] = []; // lines with associated warning
	const warnings: Warning[] = []; // type of warning

	const listItemRegex = RegExp("^(?<tabs>\t*)(?<list>[0-9]+\. |- )(?<content>.+)"); // finds lines with a list delimiter and content
	// 1: tabs
	// 2: list delimiter; xx. OR -
	// 3: content

	// line-by-line
	for (let l = 0; l < doc.lineCount(); l++) {
		const line = doc.getLine(l);
		const match = listItemRegex.exec(line);

		if (!match) {
			if (/# /.exec(line) || mapTagRegex.exec(line)) continue;

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
			warnings.push(Warning.Invalid);
			continue;
		}

		// extract list index, content and id
		let listIndex = parseListIndex(match[1]);
		listIndices.push(listIndex);
		let text = removeTags(match[3]);
		let { content, id } = getId(text);
		if (!content && !id) {
			warningLines.push(l);
			warnings.push(Warning.Invalid);
			continue;
		}

		const index = contents.push(content) - 1;
		ids.push(id);
		lines.push(l);

		const level = match[1].length;
		levels.push(level);

		if (id == null) continue; // do not check note groups
		
		content = content.toLowerCase();
		if (id) { // all notes with an id tag get linked
			const groupIndex = groups.findIndex((group) => group.id === id);
			if (groupIndex == -1) { // no matching id
				groups.push({
					content, 
					id, 
					indices: [index], 
					levels: [level], 
					ref: index,
				});
			} else {
				if (content) {
					const groupContent = groups[groupIndex].content;
					if (groupContent !== undefined) { 
						if (groupContent === "") { // first instance of tag was empty
							groups[groupIndex].content = content;
						} else if (groupContent !== content) {
							groups[groupIndex].content = undefined;
						}
					} // leave undefined as there is a conflict
				}
				groups[groupIndex].indices.push(index);
				groups[groupIndex].levels.push(level);
			}
		} else if (!content.endsWith(':')) {
			const groupIndex = groups.findIndex((group) => group.id === "" && group.content! === content);
			if (groupIndex == -1) { 
				groups.push({
					content, 
					id, 
					indices: [index], 
					levels: [level], 
					ref: index,
				});
			} else {
				groups[groupIndex].indices.push(index);
				groups[groupIndex].levels.push(level);
			}
		}
	}

	// reprocess groups
	for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
		const group = groups[groupIndex];
		if (group.indices.length == 1) {
			if (group.content === "") {
				warningLines.push(lines[group.indices[0]]);
				warnings.push(Warning.ContentNotDefined);
			}
			continue;
		}

		// check if multiple notes have children
		let parents: number[] = [];
		for (let i = 0; i < group.indices.length; i++) {
			const index = group.indices[i];
			const level = group.levels[i];
			if (levels[index + 1] > level || (levels[index + 1] == level && listIndices[index + 1] == listIndices[index] + 1)) {
				parents.push(index);
				groups[groupIndex].ref = index;
			}
		}
		if (parents.length > 1) {
			group.indices.forEach((index) => {
				warningLines.push(lines[index]);
				warnings.push(Warning.LinkConflict);
			});
			continue;
		}

		if (group.id) { // id defined; check for content errors
			let warning: Warning | undefined = undefined;
			if (group.content == "") {
				warning = Warning.ContentNotDefined;
			} else if (group.content == undefined) {
				warning = Warning.ContentConflict;
			}
			if (warning) {
				group.indices.forEach((index) => {
					warningLines.push(lines[index]);
					warnings.push(warning);
				});
			}
		} else { // assign id to content group
			let newId = group.content!.replace(/[^a-zA-Z0-9]/g, '');
			// console.log("processNotes() assigning")
			if (groups.findIndex((group) => group.id === newId)) { // id is taken
				let suffix = 1;
				while(groups.findIndex((group) => group.id === newId + suffix) != -1) suffix++; // add a valid copy number
				groups[groupIndex].id = newId + suffix;
			} else {
				groups[groupIndex].id = newId;
			}
			group.indices.forEach((index) => ids[index] = newId);
		}
	}

	// console.log("processNotes() groups:", groups);
	return {listIndices, contents, ids, lines, levels, groups, warningLines, warnings};
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

		const lineNumber = library.warningLines[i];
		// console.log("proofreadNotes() line number: ", lineNumber);
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

export function updateNotes(editor: Editor, linkSimilar: boolean) {
	const doc = editor.getDoc();
	const library = processDocument(doc);
	if (library.warningLines.length != 0) {
		new Notice("Unresolved warnings - fix notes");
		proofreadNotes(editor, library);
		return;
	}

	// recursively iterates through list to generate a list of paths
	const paths = noteTree(library.contents, library.ids, library.levels, []);
	// console.log("updateNotes(): parsed note tree. paths:", paths);

	// update the props tag for each note
	for (let i = 0; i < library.lines.length; i++) {
		const content = library.contents[i];
		const id = library.ids[i];
		const lineNumber = library.lines[i];
		const path = paths[i];
		const line = doc.getLine(lineNumber);
		
		const type = noteType(content);
		const study = type.study;
		
		// update the tag
		const noteMatch = noteRegex.exec(line);
		if (noteMatch) {
			const indices = (noteMatch as any).indices;
			const note = parseNote(noteMatch);
			note.props.path = path;

			let addId = false;
			const idTagMatch = /#\\w+/.exec(line);
			if (!idTagMatch && note.id !== "") addId = true;
			
			const start = indices[2][0]
			const end = indices[0][1];
			editor.replaceRange(
				createNoteString(note), 
				{ line: lineNumber, ch: start },
				{ line: lineNumber, ch: end }
			);
		} else { // add properties tag
			const props = createNoteProperties(study);
			props.path = path;

			let addId = false;
			const idTagMatch = /#\\w+/.exec(line);
			if (!idTagMatch && id !== "") addId = true;
			
			editor.replaceRange(
				" " + (addId ? `#${id} ` : "") + createNoteTag(props, true), 
				{ line: lineNumber, ch: line.length }
			);
		}
	}

	console.log(`updateNotes(): updated ${library.contents.length} notes`);
}

// input: array of note content and associated line number and indent level
// initially called under the mind map title
function noteTree(notes: string[], ids: (string | null)[], levels: number[], path: string[]): string[][] {
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
		let self = toNoteID(notes[i] ? notes[i] : ids[i]!); // convert to id
		let newPath = path.concat(self);
		paths.push(newPath);
		// console.log("added new path", newPath);
		// indices of slice to pass into next recursion
		let start = i + 1; 
		let end = minLevelIndices[index + 1];
		paths.push(...noteTree(notes.slice(start, end), ids.slice(start, end), levels.slice(start, end), newPath));
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
		console.log("isMindMap() mind map identified:", title);
		return title;
	} else {
		console.log("isMindMap() tag not found");
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

async function updateNote(editor: Editor) {

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