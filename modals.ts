import { EditorView } from '@codemirror/view';
import { App, Editor, Modal, Notice, Plugin, Setting, SuggestModal, TextComponent, ToggleComponent } from 'obsidian';
import { Card, createEmptyCard, FSRSParameters, generatorParameters, State } from 'ts-fsrs';
import { ListItem, MapProperties, MapSettings, MindMap, Note, Warning } from 'types';
import { notePattern, parseNote, parseNumberArray, parsePath, parseMapTag, toNoteID, toPathString, formatPath, createMapTag, errorPattern, mapTagOpen, mapTagClose, noteRegex, idTagRegex, parseListItem, canStudy, createNoteString, listItemRegex } from 'helpers';
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
			if (!note.card) return;
			switch(note.card.state) {
				case State.New: newCount++; break;
				case State.Learning || State.Relearning: learningCount++; break;
				case State.Review: reviewCount++; break;
			}
		});

		new Setting(this.contentEl)
			.setHeading()
			.setName("Progress:");

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
				.setValue(false)
				// .setValue(mindMap.map.settings.separateHeadings)
				.onChange((value) => mindMap.map.settings.separateHeadings = value)
				.setDisabled
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
	editor: Editor = {} as Editor;

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
	initial: Note;

	constructor(app: App, view: EditorView, listItemMatch: RegExpExecArray) {
		super(app);
		this.view = view;

		this.note = parseNote(listItemMatch);
		this.initial = parseNote(listItemMatch);

		let title = "";
		switch(this.note.type) {
			case 'key word':
				title += "[Key word] ";
				break;
			case 'relation':
				title += "[Relation] ";
				break;
			case 'info':
				title += "[Info] ";
				break;
		}
		title += this.note.content;
		this.setTitle(title);

		// displays path
		const pathDisplay = new Setting(this.contentEl)
      .setDesc("show path here");

		// settings
		let contentField: TextComponent;
		new Setting(this.contentEl)
			.setName("Content")
			.setDesc("Warning: changing content will disconnect children and linked notes")
			.addText((text) => 
				contentField = text
					.setPlaceholder(this.initial.content)
					.setValue(this.note.content)
					.onChange((value) => {
						const { content, type } = parseListItem(value)
						this.note.content = content;
						studyToggle.setValue(canStudy(content, type));
						// update the path display 
					}))
			.addButton((button) => button
				.setButtonText("Reset")
				.setCta()
				.onClick(() => {
					contentField.setValue(this.initial.content);
					this.note.content = this.initial.content;
					studyToggle.setValue(this.initial.card ? true : false);
					// update the path display
					// update the card display
				})
			)

		let unlinkToggle: ToggleComponent;
		let idField: TextComponent;
		new Setting(this.contentEl)
			.setName("Force unlink")
			.setDesc("Node will not merge with similar nodes")
			.addToggle((toggle) => 
				unlinkToggle = toggle
					.setValue(this.note.id === "")
					.onChange((unlink) => {
						if (unlink) {
							this.note.id = "";
							idField.setPlaceholder("linking disabled").setValue("");
						} else {
							this.note.id = this.initial.id;
							let newText = this.initial.id ? this.initial.id : "";
							idField.setPlaceholder(newText).setValue(newText);
						}
					})
			);

		new Setting(this.contentEl)
			.setName('ID')
			.setDesc("Add a new tag or search existing tags. Letters and numbers only")
			.addText((text) => 
				idField = text
					.setPlaceholder(this.note.id === "" ? "linking disabled" : (this.note.id ? this.note.id : ""))
					.setValue(this.note.id ? this.note.id : "")
					.onChange((value) => {
						let validId = value.replace(/[^a-zA-Z0-9]/, '');
						this.note.id = validId;
						idField.setValue(validId);
					})
			)
			.addButton((button) => button
				.setButtonText("Clear")
				.setCta()
				.onClick(() => {
					idField.setValue("");
					this.note.id = undefined;
				})
			)
			.addButton((button) => button
				.setButtonText("Search")
				.setCta()
				.onClick(() => {
					new IdSuggestModal(app, view, this.note.content, (id: string) => {
						this.note.id = id;
						unlinkToggle.setValue(false);
						idField.setValue(id);
						// update the content
					}).open();
				})
			);
		
		// toggle to select studyable
		let studyToggle: ToggleComponent;
		new Setting(this.contentEl)
			.setName('Studyable')
			.addToggle((toggle) => 
				studyToggle = toggle
					.setValue(this.note.card ? true : false)
					.onChange((study) => {
						if (study) {
							this.note.card = this.initial.card ? this.initial.card : createEmptyCard();
							showCardSettings(this.note.card!);
						} else {
							this.note.card = null;
							hideCardSettings();
						}
					})
			);

		// card params
		const settings = [
			new Setting(this.contentEl).setName('Card due date (can edit)'),
			new Setting(this.contentEl).setName('Card stability'),
			new Setting(this.contentEl).setName('Card difficulty'),
			new Setting(this.contentEl).setName('Card elapsed days / scheduled days'),
			new Setting(this.contentEl).setName('Card reps/lapses'),
			new Setting(this.contentEl).setName('Card state'),
			new Setting(this.contentEl).setName('Card last review')
		];

		const showCardSettings = (card: Card) => {
			settings[0]
				.addText((text) =>
					text.setValue(card.due.toString()).onChange((value) => {
						let newDate = new Date(value);
						if (newDate.valueOf()) card.due = newDate;
					}));
			settings[1]
				.addText((text) =>
					text.setPlaceholder(card.stability.toString()).setDisabled(true));
			settings[2]
				.addText((text) =>
					text.setPlaceholder(card.difficulty.toString()).setDisabled(true));
			settings[3]
				.addText((text) =>
					text.setPlaceholder(card.elapsed_days.toString() + " / " + card.scheduled_days.toString()).setDisabled(true));
			settings[4]
				.addText((text) =>
					text.setPlaceholder(card.reps.toString() + " / " + card.lapses.toString()).setDisabled(true));
			settings[5]
				.addText((text) =>
					text.setPlaceholder(State[card.state]).setDisabled(true));
			settings[6]
				.addText((text) =>
					text.setPlaceholder(card.last_review ? card.last_review.toString() : "Not studied yet"));
		}
		const hideCardSettings = () => {
			settings.forEach((setting) => setting.clear());
		}
		if (this.note.card) showCardSettings(this.note.card);
		
		const indices = (listItemMatch as any).indices;
		new Setting(this.contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('Dismiss changes')
					.setCta()
					.onClick(() => this.close())
			})
			.addButton((btn) => {
				btn
					.setButtonText('Apply changes')
					.setCta()
					.onClick(() => {
						if (this.note.content === "" && !this.note.id) {
							new Notice("Invalid card");
							return;
						}
						this.close();
						this.updateData(indices);
					})
			});
		return;
	}

	updateData(indices: number[][]) {
		const contentEdit = this.view.state.update({
			changes: {
				from: indices[3][0], 
				to: indices[3][1], 
				insert: createNoteString(this.note), 
			}
		});
		this.view.dispatch(contentEdit);
	}
}

class IdSuggestModal extends SuggestModal<ListItem> {
	callback: (id: string) => void;
	items: ListItem[];
	// this.paths: number[][];
	defaultQuery: string;

	constructor(app: App, view: EditorView, defaultQuery: string, callback: (id: string) => void) {
		super(app)
		this.callback = callback;
		this.items = [];
		// this.paths = [];
		this.defaultQuery = defaultQuery;
		
		const tagRegex = RegExp("(\\t*)(\\d+. |- ).*(#\\w+)", 'd');
		let lineNumber = 1;
		for (let line of view.state.doc.iterLines()) {
			const tagMatch = tagRegex.exec(line);
			if (tagMatch) {
				this.items.push(parseListItem(tagMatch[2] + tagMatch[3]));
			}
			lineNumber++;
		}
	}

	getSuggestions(query: string): ListItem[] {
		let q = query ? query : this.defaultQuery;
		q = q.toLowerCase();
		return this.items.filter((item) => 
			item.content.toLowerCase().includes(q) ||
			item.id && item.id.toLowerCase().includes(q)
		);
	}

	renderSuggestion(item: ListItem, el: HTMLElement): void {
		el.createEl('div', { text: item.content + " #" + item.id });
		el.createEl('small', { text: "show path here" });
	}

	onChooseSuggestion(item: ListItem, evt: MouseEvent | KeyboardEvent): void { 
		this.callback(item.id ? item.id : "");
		this.close();
	}
}