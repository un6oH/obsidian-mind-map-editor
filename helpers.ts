import { generatorParameters, createEmptyCard, FSRSParameters, Card, State } from "ts-fsrs";
import { Note, MindMap, MapSettings, ListItem } from "types";
import { interpolateRainbow, style } from "d3";

export const listItemPattern = "(\\t*)(\\d+. |- )(.+)(\\*?)";
export const listItemRegex = RegExp(listItemPattern, 'd');

export const cardTagOpen = "%%card";
export const cardTagClose = "%%";
export const cardTagPattern = `${cardTagOpen}(.*?)${cardTagClose}`;
export const cardTagRegex = RegExp(cardTagPattern, 'd');

export const notePattern = `^(?<indent>\\t*)(?<list>[0-9]+\\. |- )(?<content>.*?)${cardTagOpen}(?<card>.*?)${cardTagClose}`;
export const noteRegex = RegExp(notePattern, 'd');

export const idTagPattern = "#(\\w*)$";
export const idTagRegex = RegExp(idTagPattern, 'd');


export const mapTagOpen = "%%map";
export const mapTagClose = "%%";
export const mapTagPattern = `${mapTagOpen}(.*)${mapTagClose}`;
export const mapTagRegex = RegExp(mapTagPattern, 'd');

export const imagePattern = `\\!\\[\\[(.*?\\.png)(\\|\\d+)?\\]\\]`;
export const imageRegex = RegExp(imagePattern, 'd');

export const infoPattern = "^\\(.*\\)$";
export const infoRegex = RegExp(infoPattern);

export const errorTagOpen = "%%error";
export const errorTagClose = "%%";
export const errorTagPattern = `${errorTagOpen}(?<type>\\d*)${errorTagClose}`;
export const errorTagRegex = RegExp(errorTagPattern, 'd');
// [1]: type

export const errorPattern = `^.*(?<tag>${errorTagOpen}(?<type>\\d*)${errorTagClose})$`
export const errorRegex = RegExp(errorPattern, 'md');
// [1]: tag
// [2]: type

export function parseMindMap(text: string): MindMap | null {
	const mindMap = {} as MindMap;

	// map settings
	const mapTagRegex = new RegExp(mapTagPattern, 'gm');
	let mapMatch = mapTagRegex.exec(text);
	if (!mapMatch) {
		console.log("Study parameters not found");
		return null;
	} else {
		mindMap.map = parseMapTag(mapMatch[1]);
	}

	// notes
	const listItemRegex = new RegExp(notePattern, 'gm');
	let itemMatch;
	while ((itemMatch = listItemRegex.exec(text)) !== null) {
		mindMap.notes.push(parseNote(itemMatch));
	}

	return mindMap;
}

export function noteTree(items: ListItem[], levels: number[], path: string[]): string[][] {
	// get indices of lines of immediate children
	const notesAtCurrentLevel: number[] = [];
	for (let i = 0; i < items.length; i++) { // iterate over each entry
		if (levels[i] == path.length) {
			notesAtCurrentLevel.push(i); // add index of immediate child
			// console.log(notes[i], i);
		}
	}
	notesAtCurrentLevel.push(items.length);

	// iterate over immediate children
	let paths: string[][] = []; // path accumulator
	for (let index = 0; index < notesAtCurrentLevel.length - 1; index++) {
		const i = notesAtCurrentLevel[index];
		let self = toNoteID(items[i].content ? items[i].content : items[i].id!); // convert to id
		let newPath = path.concat(self);
		paths.push(newPath);
		let start = i + 1; 
		let end = notesAtCurrentLevel[index + 1];
		paths.push(...noteTree(items.slice(start, end), levels.slice(start, end), newPath));
	}

	return paths;
}

export function createBlankNote(): Note {
  return {
		listIndex: 0, 
    content: "", 
		type: 'key word', 
		id: undefined, 
    card: null
  }
}

// parses map tag (contents only)
export function parseMapTag(string: string): MapSettings {
	const parameters = string.trim().split(';');
	const props: Partial<FSRSParameters> = {
		enable_fuzz: parameters[3] !== "" ? parameters[3] === "true" : undefined, 
		enable_short_term: parameters[4] !== "" ? parameters[4] === "true" : undefined, 
		maximum_interval: parameters[5] !== "" ? parseFloat(parameters[5]) : undefined, 
		request_retention: parameters[6] !== "" ? parseFloat(parameters[6]) : undefined, 
		w: parameters[7] !== "" ? parseNumberArray(parameters[7]) : undefined, 
	};
	return { 
		title: parameters[0], 
		separateHeadings: parameters[1] !== "" ? parameters[1] === "true" : false, 
		crosslink: parameters[2] !== "" ? parameters[2] === "true" : true,
		studySettings: generatorParameters(props),
	};
}

// content = listItemMatch[3]
export function parseListItem(content: string): ListItem {
	content = content.trim();
	const result: ListItem = {
		content: content, 
		type: 'key word', 
		id: undefined
	}

	let idMatch = idTagRegex.exec(content);
	if (idMatch) {
		result.id = idMatch[1];
		const indices = (idMatch as any).indices;
		result.content = content.slice(0, indices[0][0]).trim();
	}

	switch (content.slice(-1)) {
		case ':':
			result.type = 'relation';
			break;
		case ')':
			if (content.startsWith('(')) {
				result.type = 'info';
			}
			break;
	}
	
	return result;
}

// parse note with or without card
// return note with assigned properties
// must pass in a RegExpExecArray matched with the note pattern
export function parseNote(match: RegExpExecArray): Note {
	const note = {} as Note;

	note.listIndex = parseListIndex(match[2]);

	// parse the card
	let listItem = match[3];
	const cardTagMatch = cardTagRegex.exec(listItem);
	if (cardTagMatch) {
		note.card = parseCard(cardTagMatch[1]);
		listItem = listItem.slice(0, cardTagMatch.index);
	} else {
		note.card = null;
	}

	const { content, id, type } = parseListItem(listItem);
	note.content = content;
	note.id = id;
	note.type = type;

	return note;
}

// return "" to force ignoring groups
// return null to allow regrouping
export function getNoteId(content: string): { content: string, id: string | undefined } {
	content = content.trim();

	const idTagMatch = idTagRegex.exec(content);
	if (idTagMatch) { // id specified
		content = content.slice(0, (idTagMatch as any).indices[0][0]).trim();
		return {
			content, 
			id: idTagMatch[1]
		}
	} else { // id not specified
		return {
			content, 
			id: undefined
		}
	}
}

export function parsePath(str: string): string[] {
	return str.split('\\');
}

export function parseCard(tag: string): Card {
	const props = tag.split(';');

	return {
		due: new Date(props[0]),
    stability: parseFloat(props[1]),
    difficulty: parseFloat(props[2]),
    elapsed_days: parseFloat(props[3]),
    scheduled_days: parseFloat(props[4]),
    reps: parseFloat(props[5]),
    lapses: parseFloat(props[6]),
    state: parseFloat(props[7]),
    last_review: props[8] ? new Date(props[8]) : undefined,
	}
}

export function canStudy(content: string, type: 'key word' | 'relation' | 'info'): boolean {
	switch(type) {
		case 'key word': return true
		case 'info': return false
		case 'relation':
			const containsClozes = /{.+?}/.test(content);
			return containsClozes;
	}
}

const NOTE_ID_MAX_LENGTH = 12;
// const pastedImageRegexGlobal = RegExp(pastedImagePattern, 'gm');
export function toNoteID(str: string, title: boolean = false): string {
	// console.log("toNoteID() string:", str);
	const imageMatch = /\!\[\[Pasted image (.*?)\.png\]\]/.exec(str);
	if (imageMatch) {
		// console.log(imageMatch[1]);
		// return "pastedimage" + Math.round(Math.random() * 100000);
		return imageMatch[1];
	}

	const alphaNumeric = str.replace(/[^a-zA-Z0-9]/g, ''); 
	const lowercase = alphaNumeric.toLowerCase();
	return lowercase
}

export function createNoteString(note: Note): string {
	// let str = note.listIndex == 0 ? "- " : `${note.listIndex}. `;
	let str = note.content;
	if (note.id !== undefined) {
		str += " #" + note.id;
	}
	if (note.card) str += createCardTag(note.card, true);
	return str;
}

// export function createNoteTag(props: NoteProperties, includeTags?: boolean): string {
// 	// console.log("createNoteTag(): props:", props);
// 	let string = includeTags ? noteTagOpen : "";

// 	// basic properties
// 	[ 
// 		toPathString(props.path),
// 		String(props.study), 
// 	].forEach(str => string += str + ';');

// 	// note does not have card, but needs one
// 	if (props.study && !props.card) props.card = createEmptyCard();

// 	// add card properties
// 	if (props.card) {
// 		const cardPropStrings = [
// 			props.card.due.toISOString(), 
// 			props.card.stability.toString(),
// 			props.card.difficulty.toString(),
// 			props.card.elapsed_days.toString(),
// 			props.card.scheduled_days.toString(),
// 			props.card.reps.toString(),
// 			props.card.lapses.toString(),
// 			props.card.state.toString(), 
// 			props.card.last_review ? props.card.last_review.toISOString() : ""
// 		];
// 		cardPropStrings.forEach(str => string += str + ';');
// 	}

// 	string += includeTags ? noteTagClose : "";
// 	return string;
// }
export function createCardTag(card: Card, includeTags?: boolean): string {
	let tag = includeTags ? cardTagOpen : "";
	const data = [
		card.stability.toString(),
		card.due.toISOString(),
		card.difficulty.toString(),
		card.elapsed_days.toString(),
		card.scheduled_days.toString(),
		card.reps.toString(),
		card.lapses.toString(),
		card.state.toString(), 
		card.last_review ? card.last_review.toISOString() : ""
	];
	data.forEach(str => tag += str + ';');
	tag += includeTags ? cardTagClose : "";
	return tag;
}

// creates map tag
export function createMapTag(settings: MapSettings, includeTags = true): string {
	const propStrings: string[] = [
		settings.title,
		settings.separateHeadings.toString(), 
		settings.crosslink.toString(), 
		settings.studySettings.enable_fuzz.toString(), 
		settings.studySettings.enable_short_term.toString(), 
		settings.studySettings.maximum_interval.toString(),
		settings.studySettings.request_retention.toString(), 
		settings.studySettings.w.join(','), 
	];
	let string = propStrings.join(';') 

	if (includeTags)
		string = mapTagOpen + string + mapTagClose;

	return string;
}

export function toPathString(path: string[]): string {
	if (!path) console.log("toPathString(): error");
	return path.join('\\');
}

export function formatPath(path: string[]): string {
	return path.join(' > ');
}

export function parseNumberArray(array: string): number[] {
  const splitString = array.split(',');
  return splitString.map((str) => parseFloat(str));
}

export function parseListIndex(str: string): number {
	const parse = parseFloat(str);
	return isNaN(parse) ? 0 : parse;
}

export function removeTags(text: string): string {
	// let noteTagMatch = noteTagRegex.exec(text) as any;
	// if (noteTagMatch) {
	// 	text = text.substring(0, noteTagMatch.indices[0][0]);
	// }
	// let errorTagMatch = errorTagRegex.exec(text) as any;
	// if (errorTagMatch) {
	// 	text = text.substring(0, errorTagMatch.indices[0][0]);
	// }
	// return text.trim();
	return text.split('%%', 1)[0].trim();
}

interface TextFragment {
	text: string,
	hidden: boolean;
	image: boolean;
	fragments: TextFragment[], 
}
export function formatContent(document: Document, text: string, viewImageCallback: (url: string) => void): { content: Element, hidden: Element } {
	const fragments: TextFragment[] = [];
	const imageRegex = new RegExp(imagePattern, 'g');
	const infoRegex = new RegExp(infoPattern);

	let infoMatch = infoRegex.exec(text);
	if (infoMatch) { // no clozes
		fragments.push({
			text, 
			hidden: false, 
			image: false, 
			fragments: [{
				text, 
				hidden: false, 
				image: false,
				fragments: [], 
			}]
		});
		// console.log("formatContent()", text, "is an info node", infoMatch);
	} else {
		// check if text has a ':'
		let colonMatch = RegExp(`.+:\\s*`).exec(text);
		if (colonMatch) {
			// before delimiter
			let before = colonMatch[0];
			// console.log(text, before);
			fragments.push({
				text: before, 
				hidden: false,
				image: false,  
				fragments: []
			});
			let after = text.slice(before.length);
			if (after) fragments.push({ // property: value pair. defaults to cloze
				text: after, 
				hidden: true,
				image: false,  
				fragments: [] 
			});
		} else { // not a ':' delimited phrase. defaults to key word
			fragments.push({
				text: text, 
				hidden: true,
				image: false,
				fragments: []
			});
		}
		
		// find clozes
		fragments.forEach((fragment, i) => {
			let text = fragment.text;
			if (!text) return;

			const regex = /{(.*?)}/g;
			let clozeMatch;
			let prevLastIndex = 0;
			while ((clozeMatch = regex.exec(text)) !== null) {
				fragment.hidden = false; // do not hide if there are clozes
				if (clozeMatch.index > prevLastIndex) { // add text before the match to the fragment list
					fragment.fragments.push({
						text: text.slice(prevLastIndex, clozeMatch.index), 
						hidden: false,
						image: false,
						fragments: []
					});
				}
				fragment.fragments.push({
					text: clozeMatch[1], 
					hidden: true,
					image: false,
					fragments: [] 
				});
				prevLastIndex = regex.lastIndex;
			}
			if (prevLastIndex < text.length) { // add last fragment
				fragment.fragments.push({
					text: text.slice(prevLastIndex), 
					hidden: fragment.hidden,
					image: false,
					fragments: []
				});
				// console.log("added tail fragment:", text.slice(prevLastIndex), prevLastIndex, text.length);
			}
		});
	}

	// check for images in each subfragment
	fragments.forEach((fragment, i) => {
		fragment.fragments.forEach((subFragment, j) => {
			let imageMatch;
			let prevLastIndex = 0;
			let text = subFragment.text;
			const imageRegex = RegExp(imagePattern, 'g');
			while ((imageMatch = imageRegex.exec(text)) !== null) {
				fragment.hidden = false; // if an image is found, the 
				if (imageMatch.index > prevLastIndex) { // add text before the match to the fragment list
					subFragment.fragments.push({
						text: text.slice(prevLastIndex, imageMatch.index), 
						hidden: subFragment.hidden,
						image: false,
						fragments: []
					});
				}
				subFragment.fragments.push({
					text: imageMatch[1], // set the text to the image url 
					hidden: subFragment.hidden,
					image: true,
					fragments: []
				});
				prevLastIndex = imageRegex.lastIndex;
			}
			if (prevLastIndex < text.length) { // add last fragment
				subFragment.fragments.push({
					text: text.slice(prevLastIndex), 
					hidden: subFragment.hidden,
					image: false,
					fragments: []
				});
				// console.log("added tail fragment:", text.slice(prevLastIndex), prevLastIndex, text.length);
			}
		});
	});
	
  const revealedLabel = document.createElement('span');
  revealedLabel.addClass("label-content");
  const hiddenLabel = document.createElement('span');
  hiddenLabel.addClass("label-hidden");
	const hiddenText = "[ . . . ]"
	const populate = (fragment: TextFragment, parentHidden: boolean) => {
		// console.log(fragment);
		if (fragment.fragments.length) {
			// condense all fragments within a hidden fragment to one box
			if (fragment.hidden && !parentHidden) {
				let hiddenFragment = document.createElement('span');
				hiddenFragment.textContent = hiddenText;
				hiddenFragment.addClass('fragment-hidden');
				hiddenLabel.appendChild(hiddenFragment);
				// console.log("formatContent() added hidden fragment:", fragment.text, "to: ", text);
			}
			// recursively populate content
			fragment.fragments.forEach(f => populate(f, fragment.hidden)); 
		} else {
			// console.log('populate() populating element');
			let contentFragment = document.createElement('span');
			if (fragment.image) {
				contentFragment.textContent = "[image]";
				contentFragment.addClass("fragment-image");
				contentFragment.onclick = () => viewImageCallback(fragment.text);
			} else {
				contentFragment.textContent = fragment.text;
			}
			contentFragment.addClass(fragment.hidden ? 'fragment-revealed' : 'fragment-normal');
			revealedLabel.appendChild(contentFragment);

			let hiddenFragment = document.createElement('span');
			if (!parentHidden) { // only add a blank if the parent is not hidden
				if (fragment.hidden) {
					hiddenFragment.textContent = hiddenText;
					hiddenFragment.addClass('fragment-hidden');
					hiddenLabel.appendChild(hiddenFragment);
				} else {
					hiddenFragment.textContent = fragment.text;
					hiddenFragment.addClass('fragment-normal');
					hiddenLabel.appendChild(hiddenFragment);
				}
			} else {
				// console.log("populate()", text, "parent hidden; no element added.");
			}
			// console.log("populate()", text, content, hidden);
			// don't add anything if the parent is already hidden
		}
	}
	fragments.forEach(fragment => populate(fragment, false));

	// console.log(text, fragments);
  return { content: revealedLabel, hidden: hiddenLabel };
}

export const COLOUR_DIVISIONS = 8;
export const colourSet = new Array(COLOUR_DIVISIONS).fill(0).map((_, i) => interpolateRainbow(i / COLOUR_DIVISIONS));
export function colour(t: number) {
	return colourSet[t % COLOUR_DIVISIONS];
}
const cardStateColours: string[] = [];
cardStateColours[State.Learning] = "#F87171";
cardStateColours[State.New] = "#93C5FD";
cardStateColours[State.Review] = "#22C55E";
cardStateColours[State.Relearning] = "#F87171";
export { cardStateColours };