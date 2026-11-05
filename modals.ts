import { EditorView } from '@codemirror/view';
import { App, ButtonComponent, Editor, Modal, Notice, Plugin, Setting, SuggestModal, TextComponent, ToggleComponent } from 'obsidian';
import { Card, createEmptyCard, FSRSParameters, generatorParameters, State } from 'ts-fsrs';
import { ListItem, MapSettings, MindMap, Note, Warning } from 'types';
import { notePattern, parseNote, parseNumberArray, parseMapTag, toNoteID, generateMapString, errorPattern, mapTagOpen, mapTagClose, noteRegex, idTagRegex, parseListItem, canStudy, generateNoteString } from 'helpers';
import MindMapEditorPlugin, { dismissWarnings, openMindMapView, updateMapSettings, createCards } from 'main';

export class MindMapCreatorModal extends Modal {
	constructor(app: App, title: string, editorCallback: (text: string) => void) {
		super(app);

		this.setTitle("Create a mind map");
		const map: MapSettings = {
			title: title ? title : "My mind map",
			separateHeadings: false, 
			crosslink: true, 
			studySettings: generatorParameters(),
		}

		new Setting(this.contentEl)
			.setName("Title")
			.addText((text) => text
				.setPlaceholder(map.title)
				.onChange((value) => {
					map.title = value;
				}));

		new Setting(this.contentEl)
			.setName("Separate headings")
			.setDesc("Turn on to remove the centre node to create separate mind maps")
			.addToggle((toggle) => toggle
				.setValue(map.separateHeadings)
				.onChange((value) => map.separateHeadings = value)
			);	

		new Setting(this.contentEl)
			.setName("Crosslink")
			.setDesc("Identical key words link together")
			.addToggle((toggle) => toggle
				.setValue(map.crosslink)
				.onChange((value) => map.crosslink = value)
			);

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
					editorCallback(generateMapString(map, true));
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
					createCards(editor);
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
				.setValue(mindMap.map.separateHeadings)
				// .setValue(mindMap.map.settings.separateHeadings)
				.onChange((value) => mindMap.map.separateHeadings = value)
				.setDisabled(true)
			);
			
		new Setting(this.contentEl)
			.setName("Crosslink")
			.setDesc("Identical key words link together")
			.addToggle((toggle) => toggle
				.setValue(mindMap.map.crosslink)
				.onChange((value) => mindMap.map.crosslink = value)
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
					openMindMapView(plugin, editor, mindMap);
					this.close();
				}));
	}
}

export class MapSettingsEditorModal extends Modal {
	editor: Editor = {} as Editor;

	// start and end of tag
	constructor(app: App, view: EditorView, match: RegExpExecArray) {
		// console.log("Created map study settings editor modal", "start:", start, "end:", end);
		super(app);
		
		// parse data string
		this.setTitle("Map settings");
		const map = parseMapTag(match[1]);

		new Setting(this.contentEl)
			.setName("Title")
			.addText(text => 
				text
					.setPlaceholder(map.title)
					.setValue(map.title)
					.onChange((value) => {
						map.title = value;
					})
			);

		new Setting(this.contentEl)
			.setName("Separate headings")
			.setDesc("Turn on to remove the centre node to create separate mind maps")
			.addToggle((toggle) => toggle
				.setValue(map.separateHeadings)
				.onChange((value) => map.separateHeadings = value)
			);
		new Setting(this.contentEl)
			.setName("Crosslink")
			.setDesc("Identical key words link together")
			.addToggle((toggle) => toggle
				.setValue(map.crosslink)
				.onChange((value) => map.crosslink = value)
			);
		new Setting(this.contentEl)
      .setName('Enable fuzz')
      .addToggle((toggle) => toggle
				.setValue(map.studySettings.enable_fuzz)
				.onChange((value) => map.studySettings.enable_fuzz = value)
			);
		new Setting(this.contentEl)
			.setName('Enable short term')
			.addToggle((toggle) => toggle
				.setValue(map.studySettings.enable_short_term)
				.onChange((value) => map.studySettings.enable_short_term = value)
			);
		new Setting(this.contentEl)
			.setName('maximum interval')
			.addText((text) =>
				text.setPlaceholder(map.studySettings.maximum_interval.toString()).onChange((value) => {
					map.studySettings.maximum_interval = parseFloat(value);
				}));
		new Setting(this.contentEl)
			.setName('Request retention')
			.addText((text) =>
				text.setPlaceholder(map.studySettings.request_retention.toString()).onChange((value) => {
					map.studySettings.request_retention = parseFloat(value);
				}));

		const indices = (match as any).indices;
		new Setting(this.contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('OK')
					.setCta()
					.onClick(() => {
						this.updateSettings(view, map, indices[1][0], indices[1][1]);
						this.close();
					})
			});
	}

	updateSettings(view: EditorView, settings: MapSettings, from: number, to: number) {
		const edit = view.state.update({
			changes: { from, to, insert: generateMapString(settings, false) }
		});
		view.dispatch(edit);
	}
}

// Called from note widget. Specifies start and end indices of text within widget
export class NoteEditorModal extends Modal {
	constructor(app: App, view: EditorView, listItemMatch: RegExpExecArray) {
		super(app);
		const note = parseNote(listItemMatch);
		const card = note.card!;
		const initial = parseNote(listItemMatch);

		let contentField: TextComponent;
		let unlinkToggle: ToggleComponent;
		let idField: TextComponent;
		let studyToggle: ToggleComponent;
		let applyChangesButton: ButtonComponent;

		let title = "";
		switch(note.type) {
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
		title += note.content;
		this.setTitle(title);

		// displays path
		const pathDisplay = new Setting(this.contentEl)
      .setDesc("show path here");

		// settings
		new Setting(this.contentEl)
			.setName("Content")
			// .setDesc("Warning: changing content may disconnect linked notes")
			.addText((text) => 
				contentField = text
					.setPlaceholder(initial.content)
					.setValue(note.content)
					.onChange((value) => {
						const { content, type } = parseListItem(value)
						note.content = content;
						if (content === "" && !note.id) {
							applyChangesButton.setDisabled(true);
						} else {
							applyChangesButton.setDisabled(false);
						}
						studyToggle.setValue(canStudy(content, type));
						// update the path display 
					}))
			.addButton((button) => 
				button
					.setButtonText("Reset")
					.setCta()
					.onClick(() => {
						contentField.setValue(initial.content);
						note.content = initial.content;
						studyToggle.setValue(initial.card ? true : false);
						// update the path display
						// update the card display
					})
			)

		new Setting(this.contentEl)
			.setName("Force unlink")
			.setDesc("Node will not merge with similar nodes")
			.addToggle((toggle) => 
				unlinkToggle = toggle
					.setValue(note.id === "") // blank # means force unlink
					.onChange((unlink) => {
						if (unlink) {
							note.id = "";
							idField.setPlaceholder("linking disabled").setValue("");
						} else {
							note.id = initial.id ? initial.id : undefined;
							let newText = initial.id ? initial.id : "";
							idField.setPlaceholder(newText).setValue(newText);
						}
						idField.setDisabled(unlink);
					})
			);

		new Setting(this.contentEl)
			.setName('ID')
			.setDesc("Add a new tag or search existing tags. Letters and numbers only")
			.addText((text) => 
				idField = text
					.setPlaceholder(note.id === "" ? "linking disabled" : (note.id ? note.id : ""))
					.setValue(note.id ? note.id : "")
					.setDisabled(note.id === "")
					.onChange((value) => {
						let validId = value.replace(/[^a-zA-Z0-9]/, '');
						idField.setValue(validId);
						if (validId === "") {
							note.id = undefined;
							if (note.content === "") {
								applyChangesButton.setDisabled(true);
							}
						} else {
							applyChangesButton.setDisabled(false);
							note.id = validId;
						}
					})
			)
			.addButton((button) => button
				.setButtonText("Clear")
				.setCta()
				.onClick(() => {
					idField.setValue("");
					note.id = undefined;
				})
			)
			.addButton((button) => button
				.setButtonText("Search")
				.setCta()
				.onClick(() => {
					new IdSuggestModal(app, view, note.content, (id: string) => {
						note.id = id;
						unlinkToggle.setValue(false);
						idField.setValue(id);
						// update the content
					}).open();
				})
			);
		
		// toggle to select studyable
		const studySetting = new Setting(this.contentEl)
			.setName('Studyable')
			.addToggle((toggle) => 
				studyToggle = toggle
					.setValue(note.card ? true : false)
					.onChange((study) => {
						if (study) {
							note.card = initial.card ? initial.card : createEmptyCard();
							studySetting.setDesc("");
							applyChangesButton.setButtonText("Apply changes");
							unlockCardSettings();
						} else {
							note.card = null;
							studySetting.setDesc("Incorrect format to be studied. The card will be deleted.");
							applyChangesButton.setButtonText("Delete card");
							lockCardSettings();
						}
					})
					.setDisabled(true)
			);
			
		let dueDateSetting: Setting;
		dueDateSetting = new Setting(this.contentEl)
			.setName('Due date')
			.addText((text) =>
				text.setValue(card.due.toString()).onChange((value) => {
					let newDate = new Date(value);
					if (newDate.valueOf()) card.due = newDate;
				})
			);

		// card params
		const info = new DocumentFragment();
		info.append(
			createEl('p', { text: `Stability: ${card.stability.toString()}` }),
			createEl('p', { text: `Difficulty: ${card.difficulty.toString()}` }),
			createEl('p', { text: `Elapsed days: ${card.elapsed_days.toString()}` }),
			createEl('p', { text: `Scheduled days: ${card.scheduled_days.toString()}` }),
			createEl('p', { text: `Reps: ${card.reps.toString()}` }),
			createEl('p', { text: `Lapses: ${card.lapses.toString()}` }),
			createEl('p', { text: `State: ${State[card.state]}` }),
			createEl('p', { text: `Last Reviewed: ${card.last_review ? card.last_review.toString() : "Not studied yet"}` }),
		)
		new Setting(this.contentEl)
			.setName("Other card information")
			.setHeading()
			.setDesc(info);

		const unlockCardSettings = () => {
			dueDateSetting.setDisabled(false);
		}
		const lockCardSettings = () => {
			dueDateSetting.setDisabled(true);
		}

		const indices = (listItemMatch as any).indices;
		new Setting(this.contentEl)
			.addButton(btn => 
				btn
					.setButtonText('Dismiss changes')
					.setCta()
					.onClick(() => this.close())
			)
			.addButton(btn => 
				applyChangesButton = btn
					.setButtonText('Apply changes')
					.setCta()
					.onClick(() => {
						this.close();
						this.updateData(view, indices, note);
					})
			);
		return;
	}

	// indices of noteMatch
	updateData(view: EditorView, indices: number[][], note: Note) {
		const contentEdit = view.state.update({
			changes: {
				from: indices[3][0], 
				to: indices[0][1], 
				insert: generateNoteString(note)
			}
		});
		view.dispatch(contentEdit);
	}
}

class IdSuggestModal extends SuggestModal<ListItem> {
	callback: (id: string) => void;
	items: ListItem[];
	defaultQuery: string;
	constructor(app: App, view: EditorView, defaultQuery: string, callback: (id: string) => void) {
		super(app)
		this.callback = callback;
		this.items = [];
		// this.paths = [];
		this.defaultQuery = defaultQuery;
		
		const tagRegex = RegExp("(\\t*)(\\d+. |- )(.*?)(#\\w+)", 'd');
		for (let line of view.state.doc.iterLines()) {
			const tagMatch = tagRegex.exec(line);
			if (tagMatch) {
				this.items.push({
					content: tagMatch[3].trim(), 
					type: 'key word', 
					id: tagMatch[4].slice(1)
				});
			}
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
		// el.createEl('small', { text: "show path here" });
	}

	onChooseSuggestion(item: ListItem, evt: MouseEvent | KeyboardEvent): void { 
		this.callback(item.id ? item.id : "");
		this.close();
	}
}