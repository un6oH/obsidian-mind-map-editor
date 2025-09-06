import { EditorView } from '@codemirror/view';
import { App, Editor, Modal, Notice, Plugin, Setting, SuggestModal } from 'obsidian';
import { FSRSParameters, generatorParameters, State } from 'ts-fsrs';
import { MapProperties, Note } from 'types';
import { notePattern, parseNote, parseNumberArray, parsePath, parseStudyParameters, toNoteID, toPathString, formatPath, createNoteTag, createMapTag } from 'helpers';
import MindMapEditorPlugin, { studyNotes, updateNotes } from 'main';

export class MindMapCreatorModal extends Modal {
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
					map.id = toNoteID(value, false);
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

export class UpdateNotesModal extends Modal {
	constructor(app: App, editor: Editor, title: string) {
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
					updateNotes(editor, settings.linkSimilar, title);
					this.close();
				}));
	}
}

export class StudyNotesModal extends Modal {
	constructor(app: App, plugin: MindMapEditorPlugin, editor: Editor, title: string) {
		super(app);

		this.setTitle("Study notes");
		
		new Setting(this.contentEl)
			.setName("Update notes")
			.addButton((button) => button
				.setButtonText("Update")
				.setCta()
				.onClick(() => {
					new UpdateNotesModal(app, editor, title).open();
				}));
		
		new Setting(this.contentEl)
			.setName("Study mind map")
			.addButton((button) => button
				.setButtonText("Let's go!")
				.setCta()
				.onClick(() => {
					studyNotes(app, plugin, editor);
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