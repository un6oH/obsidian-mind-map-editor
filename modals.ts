import { EditorView } from '@codemirror/view';
import { App, Editor, Modal, Notice, Plugin, Setting, SuggestModal, TextComponent, ToggleComponent } from 'obsidian';
import { FSRSParameters, generatorParameters, State } from 'ts-fsrs';
import { MapProperties, MapSettings, MindMap, Note, Warning } from 'types';
import { notePattern, parseNote, parseNumberArray, parsePath, parseMapTag, toNoteID, toPathString, formatPath, createNoteTag, createMapTag, noteTagOpen, noteTagClose, errorPattern, mapTagOpen, mapTagClose, noteRegex, idTagRegex } from 'helpers';
import MindMapEditorPlugin, { dismissWarnings, studyMindMap, updateMapSettings, updateNotes } from 'main';

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
	constructor(app: App, editor: Editor) {
		super(app);

		this.setTitle("Update notes");

		const settings = parseMapTag(editor.getLine(1));

		new Setting(this.contentEl)
			.setName(`Crosslink ${settings.crosslink ? "enabled" : "disabled"}`);

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText("Dismiss")
				.setCta()
				.onClick(this.close))
			.addButton((button) => button
				.setButtonText("Update notes")
				.setCta()
				.onClick(() => {
					updateNotes(editor, settings.crosslink);
					this.close();
				}));
	}
}

export class StudyMindMapModal extends Modal {
	constructor(plugin: MindMapEditorPlugin, editor: Editor, mindMap: MindMap) {
		super(plugin.app);

		this.setTitle("Study " + mindMap.map.title);

		let newCount = 0, learningCount = 0, reviewCount = 0;
		mindMap.notes.forEach((note) => {
			if (!note.props.study) return;
			switch(note.props.card!.state) {
				case State.New: newCount++; break;
				case State.Learning || State.Relearning: learningCount++; break;
				case State.Review: reviewCount++; break;
			}
		})

		new Setting(this.contentEl)
			.setName("New:")
			.addText((text) => text
				.setValue(newCount.toString())
				.setDisabled(true)
			);

		new Setting(this.contentEl)
			.setName("Learning:")
			.addText((text) => text
				.setValue(learningCount.toString())
				.setDisabled(true)
			);

		new Setting(this.contentEl)
			.setName("To Review:")
			.addText((text) => text
				.setValue(reviewCount.toString())
				.setDisabled(true)
			);

		new Setting(this.contentEl)
			.setHeading()
			.setName("Settings:");

		new Setting(this.contentEl)
			.setName("Separate headings")
			.setDesc("Turn on to remove the centre node to create separate mind maps")
			.addToggle((toggle) => toggle
				.setValue(mindMap.map.settings.separateHeadings)
				.onChange((value) => mindMap.map.settings.separateHeadings = value)
			);
		new Setting(this.contentEl)
			.setName("Crosslink")
			.setDesc("Identical key words link together")
			.addToggle((toggle) => toggle
				.setValue(mindMap.map.settings.crosslink)
				.onChange((value) => mindMap.map.settings.crosslink = value)
			);
		
		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText("Update")
				.setCta()
				.onClick(() => {
					new UpdateNotesModal(plugin.app, editor).open();
				}))
			.addButton((button) => button
				.setButtonText("Let's go!")
				.setCta()
				.onClick(() => {
					studyMindMap(plugin, editor, mindMap);
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

	constructor(app: App, view: EditorView, noteMatch: RegExpExecArray) {
		super(app);
		this.view = view;

		this.note = parseNote(noteMatch);
		const initialContent = this.note.content;
		const initialId = this.note.id == null ? "" : this.note.id;

		let title = this.note.content;
		// console.log(title);
		if (this.note.content.endsWith(":")) {
			title = title.slice(0, -1);
			title = title + " (Relation)"
		} else {
			title = title + " (Key word)";
		}
		this.setTitle(title);

		// displays path
		new Setting(this.contentEl)
      .setDesc(formatPath(this.note.props.path));

		// settings
		let contentField: TextComponent;
		new Setting(this.contentEl)
			.setName("Content")
			.setDesc("Warning: changing content will disconnect children and linked notes")
			.addText((text) => 
				contentField = text
					.setPlaceholder(initialContent)
					.setValue(this.note.content)
					.onChange((value) => {
						this.note.content = value.trim();
						this.note.props.path.splice(-1, 1, toNoteID(value));
					}))
			.addButton((button) => button
				.setButtonText("Reset")
				.setCta()
				.onClick(() => {
					contentField.setValue(initialContent);
					this.note.content = initialContent.trim();
					this.note.props.path.splice(-1, 1, toNoteID(initialContent));
					// console.log("reset");
				})
			)

		let unlinkToggle: ToggleComponent;
		let idField: TextComponent;
		new Setting(this.contentEl)
			.setName("Linking disabled")
			.setDesc("Ignore tags and prevent crosslinking")
			.addToggle((toggle) => 
				unlinkToggle = toggle
					.setValue(this.note.id === null)
					.onChange((unlink) => {
						this.note.id = unlink ? null : initialId;
						idField.setValue(unlink ? "" : initialId);
					})
			);

		new Setting(this.contentEl)
			.setName('ID')
			.setDesc("Add a new tag or search existing tags. Letters and numbers only")
			.addText((text) => 
				idField = text
					.setPlaceholder(this.note.id ? this.note.id : "")
					.setValue(this.note.id ? this.note.id : "")
					.onChange((value) => {
						this.note.id = value.replace(/[^a-zA-Z0-9]/, '');
						unlinkToggle.setValue(false);
					})
			)
			.addButton((button) => button
				.setButtonText("Clear")
				.setCta()
				.onClick(() => {
					idField.setValue("");
					this.note.id = "";
				})
			)
			.addButton((button) => button
				.setButtonText("Search")
				.setCta()
				.onClick(() => {
					new IdSuggestModal(app, view, this.note.content, (id: string) => {
						this.note.id = id;
						idField.setDisabled(false).setValue(id);
						unlinkToggle.setValue(false);
					}).open();
				})
			);
		
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
				.setName('Card elapsed days / scheduled days')
				.addText((text) =>
					text.setPlaceholder(card.elapsed_days.toString() + " / " + card.scheduled_days.toString()).setDisabled(true));
			// new Setting(this.contentEl)
			// 	.setName('Card scheduled days')
			// 	.addText((text) =>
			// 		text.setPlaceholder(card.scheduled_days.toString()).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card reps/lapses')
				.addText((text) =>
					text.setPlaceholder(card.reps.toString() + " / " + card.lapses.toString()).setDisabled(true));
			// new Setting(this.contentEl)
			// 	.setName('Card lapses')
			// 	.addText((text) =>
			// 		text.setPlaceholder().setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card state')
				.addText((text) =>
					text.setPlaceholder(State[card.state]).setDisabled(true));
			new Setting(this.contentEl)
				.setName('Card last review')
				.addText((text) =>
					text.setPlaceholder(card.last_review ? card.last_review.toString() : "not reviewed yet").setDisabled(true));
		}
		
		const indices = (noteMatch as any).indices;
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
		let content = this.note.content.trim();
		if (this.note.id === null) {
			content += "*";
		} else if (this.note.id) {
			content += " #" + this.note.id;
		}
		const contentEdit = this.view.state.update({
			changes: {
				from: indices[3][0], 
				to: indices[3][1], 
				insert: content + " ", 
			}
		});

		const propsEdit = this.view.state.update({
			changes: {
				from: indices[4][0], 
				to: indices[4][1], 
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
	id: string;
	content: string;
	path: string[];
};
class IdSuggestModal extends SuggestModal<ID> {
	callback: (id: string) => void;
	notes: ID[];
	defaultQuery: string;

	constructor(app: App, view: EditorView, defaultQuery: string, callback: (id: string) => void) {
		super(app)
		this.callback = callback;
		this.notes = [];
		this.defaultQuery = defaultQuery;
		
		const text = view.state.doc.toString();
		let taggedNoteMatch;
		// split match into 
		const taggedNoteRegex = RegExp(`([0-9]+\. |- )(.*?)(#\\w+)\\s*${noteTagOpen}(.*?)${noteTagClose}`, 'g');
		while ((taggedNoteMatch = taggedNoteRegex.exec(text)) !== null) {
			let content = taggedNoteMatch[2].trim();
			let id = taggedNoteMatch[3].slice(1);
			let path = parsePath(taggedNoteMatch[4].split(';')[0]);
			this.notes.push({ content, id, path });
		}
		// console.log(this.notes);
	}

	getSuggestions(query: string): ID[] {
		let q = query ? query : this.defaultQuery;
		q = q.toLowerCase();
		return this.notes.filter((note) => 
			note.content.toLowerCase().includes(q) ||
			note.id.includes(q)
		);
	}

	renderSuggestion(note: ID, el: HTMLElement): void {
		el.createEl('div', { text: note.content + " #" + note.id });
		el.createEl('small', { text: formatPath(note.path) });
	}

	onChooseSuggestion(note: ID, evt: MouseEvent | KeyboardEvent): void {
		this.callback(note.id);
		this.close();
	}
}