import { EditorView } from '@codemirror/view';
import { App, Editor, Modal, Notice, Plugin, Setting, SuggestModal } from 'obsidian';
import { FSRSParameters, generatorParameters, State } from 'ts-fsrs';
import { MapProperties, MapSettings, Note, Warning } from 'types';
import { notePattern, parseNote, parseNumberArray, parsePath, parseMapTag, toNoteID, toPathString, formatPath, createNoteTag, createMapTag, noteTagOpen, noteTagClose, errorPattern, mapTagOpen, mapTagClose } from 'helpers';
import MindMapEditorPlugin, { dismissWarnings, studyNotes, updateMapSettings, updateNotes } from 'main';

export class MindMapCreatorModal extends Modal {
	constructor(app: App, title: string, editorCallback: (text: string) => void) {
		super(app);

		this.setTitle("Create a mind map");
		const map: MapProperties = {
			title: title ? title : "My mind map",
			id: 'id', 
			settings: {
				separateHeadings: false, 
				crosslink: true, 
				studySettings: generatorParameters(),
			}
		}
		new Setting(this.contentEl)
			.setName("Title")
			.addText((text) => text
				.setPlaceholder(map.title)
				.onChange((value) => {
					map.title = value;
					map.id = toNoteID(value, false);
				}));

		new Setting(this.contentEl)
			.setName("Separate headings")
			.setDesc("Turn on to remove the centre node to create separate mind maps")
			.addToggle((toggle) => toggle
				.setValue(map.settings.separateHeadings)
				.onChange((value) => map.settings.separateHeadings = value)
			);	

		new Setting(this.contentEl)
			.setName("Crosslink")
			.setDesc("Identical key words link together")
			.addToggle((toggle) => toggle
				.setValue(map.settings.crosslink)
				.onChange((value) => map.settings.crosslink = value)
			);

		new Setting(this.contentEl)
			.setName("Desired retention")
			.addText((text) => text
				.setPlaceholder(map.settings.studySettings.request_retention.toString())
				.onChange((value) => {
					let v = parseFloat(value);
					if (v) map.settings.studySettings.request_retention = v;
				}));
		
		new Setting(this.contentEl)
			.setName("Maximum interval")
			.addText((text) => text
				.setPlaceholder(map.settings.studySettings.maximum_interval.toString())
				.onChange((value) => {
					let v = parseFloat(value);
					if (v) map.settings.studySettings.maximum_interval = v;
				}));

		new Setting(this.contentEl)
			.setName("Parameters")
			.addText((text) => text
				.setPlaceholder(map.settings.studySettings.w.toString())
				.onChange((value) => {
					let v = parseNumberArray(value);
					if (v) map.settings.studySettings.w = v;
				}));

		new Setting(this.contentEl)
			.setName("Enable fuzz")
			.addText((text) => text
				.setPlaceholder(map.settings.studySettings.enable_fuzz.toString())
				.onChange((value) => {
					let v = value === "true";
					if (v) map.settings.studySettings.enable_fuzz = v;
				}));
		
		new Setting(this.contentEl)
			.setName("Enable short term")
			.addText((text) => text
				.setPlaceholder(map.settings.studySettings.enable_short_term.toString())
				.onChange((value) => {
					let v = value === "true";
					if (v) map.settings.studySettings.enable_short_term = v;
				}));

		new Setting(this.contentEl)
			.addButton((btn) => btn
				.setButtonText("Create")
				.setCta()
				.onClick(() => {
					this.close();
					editorCallback("# " + map.title + "\n" + createMapTag(map.settings, true));
				})
			)
	}
}

export class UpdateNotesModal extends Modal {
	constructor(app: App, editor: Editor, title: string) {
		super(app);

		this.setTitle("Update notes");

		let proofread = false;
		const settings = parseMapTag(editor.getLine(1));

		new Setting(this.contentEl)
			.setName("Proofread")
			.addToggle((toggle) => toggle
				.setValue(proofread)
				.onChange(value => proofread = value))
			.addButton((button) => button
				.setButtonText("Dismiss all warnings")
				.setCta()
				.onClick(() => dismissWarnings(editor)));

		new Setting(this.contentEl)
			.setName(`Crosslink: ${settings.crosslink ? "enabled" : "disabled"}`);

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText("Dismiss")
				.setCta()
				.onClick(this.close))
			.addButton((button) => button
				.setButtonText("Update notes")
				.setCta()
				.onClick(() => {
					updateNotes(editor, proofread, settings.crosslink, title);
					this.close();
				}));
	}

	// dismissWarnings(editor: Editor) {
	// 	const doc = editor.getDoc();
	// 	const lineCount = doc.lineCount();
	// 	const errorTagRegex = RegExp(errorTagPattern, 'd')
	// 	for (let l = lineCount - 1; l >= 0; l--) {
	// 		const line = doc.getLine(l);
	// 		const match = errorTagRegex.exec(line);

	// 		if (!match) continue;

	// 		const indices: number[][] = (match as any).indices;
	// 		const start = indices[1][0];
	// 		const end = indices[1][2];

	// 		editor.replaceRange("", 
	// 			{ line: l, ch: start },
	// 			{ line: l, ch: end }
	// 		);
	// 	}

	// 	console.log("UpdateNotes.dismissWarnings(): Dismissed all warnings")
	// }
}

export class StudyNotesModal extends Modal {
	constructor(app: App, plugin: MindMapEditorPlugin, editor: Editor, title: string) {
		super(app);

		this.setTitle("Study notes");
		
		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText("Update")
				.setCta()
				.onClick(() => {
					new UpdateNotesModal(app, editor, title).open();
				}))
			.addButton((button) => button
				.setButtonText("Let's go!")
				.setCta()
				.onClick(() => {
					studyNotes(app, plugin, editor);
					this.close();
				}));
	}
}

export class MapSettingsEditorModal extends Modal {
	editor: Editor;

	// start and end of tag
	constructor(app: App, view: EditorView, from: number, to: number) {
		// console.log("Created map study settings editor modal", "start:", start, "end:", end);
		super(app);
		
		// parse data string
		this.setTitle("Map settings");
		const tag = view.state.doc.sliceString(from, to);
		const settings = parseMapTag(tag);

		new Setting(this.contentEl)
			.setName("Separate headings")
			.setDesc("Turn on to remove the centre node to create separate mind maps")
			.addToggle((toggle) => toggle
				.setValue(settings.separateHeadings)
				.onChange((value) => settings.separateHeadings = value)
			);
		new Setting(this.contentEl)
			.setName("Crosslink")
			.setDesc("Identical key words link together")
			.addToggle((toggle) => toggle
				.setValue(settings.crosslink)
				.onChange((value) => settings.crosslink = value)
			);
		new Setting(this.contentEl)
      .setName('Enable fuzz')
      .addToggle((toggle) => toggle
				.setValue(settings.studySettings.enable_fuzz)
				.onChange((value) => settings.studySettings.enable_fuzz = value)
			);
		new Setting(this.contentEl)
			.setName('Enable short term')
			.addToggle((toggle) => toggle
				.setValue(settings.studySettings.enable_short_term)
				.onChange((value) => settings.studySettings.enable_short_term = value)
			);
		new Setting(this.contentEl)
			.setName('maximum interval')
			.addText((text) =>
				text.setPlaceholder(settings.studySettings.maximum_interval.toString()).onChange((value) => {
					settings.studySettings.maximum_interval = parseFloat(value);
				}));
		new Setting(this.contentEl)
			.setName('Request retention')
			.addText((text) =>
				text.setPlaceholder(settings.studySettings.request_retention.toString()).onChange((value) => {
					settings.studySettings.request_retention = parseFloat(value);
				}));
		new Setting(this.contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('OK')
					.setCta()
					.onClick(() => {
						this.updateSettings(view, settings, from, to);
						this.close();
					})
			});
	}

	updateSettings(view: EditorView, settings: MapSettings, from: number, to: number) {
		const edit = view.state.update({
			changes: { from, to, insert: createMapTag(settings, true) }
		});
		view.dispatch(edit);
	}
}

// Called from note widget. Specifies start and end indices of text within widget
export class NotePropertyEditorModal extends Modal {
	view: EditorView;
	note: Note;

	constructor(app: App, view: EditorView, indices: number[][]) {
		super(app);
		this.view = view;

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
					new IdSuggestModal(app, view, this.note.content, (id: string) => {
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

		// list type and order
		const index = this.note.props.listIndex ? this.note.props.listIndex.toString() : "unordered"
		new Setting(this.contentEl)
			.setName('Index')
			.addText((text) =>
				text.setPlaceholder(index).setDisabled(true));
		
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
						if (newDate.valueOf()) card.due = newDate;
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
					.setButtonText('Remove card')
					.setCta()
					.onClick(() => {
						this.note.props.card = card;
						this.close();
						this.deleteCard(indices);
					})
			})
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
				from: indices[2][0], 
				to: indices[2][1], 
				insert: " " + this.note.content.trim() + " ", 
			}
		});

		const propsEdit = this.view.state.update({
			changes: {
				from: indices[3][0], 
				to: indices[3][1], 
				insert: createNoteTag(this.note.props, false), 
			}
		});
		this.view.dispatch(contentEdit, propsEdit);
	}

	deleteCard(indices: number[][]) {
		const edit = this.view.state.update({
			changes: {
				from: indices[3][0] - noteTagOpen.length,
				to: indices[3][1] + noteTagClose.length,
			}
		});
		this.view.dispatch(edit);
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