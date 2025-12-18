import { generatorParameters, createEmptyCard, FSRSParameters, Card, State } from "ts-fsrs";
import { MapProperties, NoteProperties, Note, MindMap, MapSettings } from "types";
import { interpolateRainbow } from "d3";

export const noteTagOpen = "%%note";
export const noteTagClose = "%%";
export const notePattern = `^(?<indent>\\t*)(?<list>[0-9]+\. |- )(?<content>.*?)${noteTagOpen}(?<props>.*?)${noteTagClose}`;
export const noteRegex = RegExp(notePattern, 'd');
// [1]: list delimiter
// [2]: content
// [3]: props tag

export const noteTagPattern = `${noteTagOpen}(.*?)${noteTagClose}`;
export const noteTagRegex = RegExp(noteTagPattern, 'd');

export const idTagPattern = "#\\w+";
export const idTagRegex = RegExp(idTagPattern, 'd');

export const mapTagOpen = "%%map";
export const mapTagClose = "%%";
export const mapTagPattern = `${mapTagOpen}(.*?)${mapTagClose}`;
export const mapTagRegex = RegExp(mapTagPattern, 'd');

export const pastedImagePattern = "\!\[\[Pasted image (.*?)\.png\]\]";
export const pastedImageRegex = RegExp(pastedImagePattern, 'd');

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
	const mindMap: MindMap = {
		map: {
			title: "title", 
      id: "", 
			settings: { 
				separateHeadings: false, 
				crosslink: true, 
				studySettings: generatorParameters(), 
			}, 
		}, 
		notes: []
	};

	// title
	const titleRegex = new RegExp("# (.*?)$", 'm');
	let titleMatch = titleRegex.exec(text);
  // console.log(titleMatch);
	if (!titleMatch) {
		console.log("Mind map title not found");
		return null;
	} else {
		mindMap.map.title = titleMatch[1];
    mindMap.map.id = toNoteID(titleMatch[1], false);
	}

	// map settings
	const mapTagRegex = new RegExp(mapTagPattern, 'gm');
	let mapMatch = mapTagRegex.exec(text);
	if (!mapMatch) {
		console.log("Study parameters not found");
		return null;
	} else {
		const settings = parseMapTag(mapMatch[0]);
		mindMap.map.settings = settings;
	}

	// notes
	const noteRegex = new RegExp(notePattern, 'gm');
	let noteMatch;
	while ((noteMatch = noteRegex.exec(text)) !== null) {
		mindMap.notes.push(parseNote(noteMatch));
	}

	return mindMap;
}

export function createNoteProperties(study: boolean): NoteProperties {
	return {
		path: [], 
		study: study, 
		card: study ? createEmptyCard(Date.now()) : null, 
	}
}

export function createBlankNote(): Note {
  return {
		listIndex: 0, 
    content: "", 
		type: 'key word', 
		id: null, 
    props: createNoteProperties(false), 
  }
}

// parses map tag (contents only)
export function parseMapTag(string: string): MapSettings {
	const data = string.slice(mapTagOpen.length, string.length - mapTagClose.length)
	const parameters = data.trim().split(';');
	const props: Partial<FSRSParameters> = {
		enable_fuzz: parameters[2] !== "" ? parameters[2] === "true" : undefined, 
		enable_short_term: parameters[3] !== "" ? parameters[3] === "true" : undefined, 
		maximum_interval: parameters[4] !== "" ? parseFloat(parameters[4]) : undefined, 
		request_retention: parameters[5] !== "" ? parseFloat(parameters[5]) : undefined, 
		w: parameters[6] !== "" ? parseNumberArray(parameters[6]) : undefined, 
	};
	return { 
		separateHeadings: parameters[0] !== "" ? parameters[0] === "true" : false, 
		crosslink: parameters[1] !== "" ? parameters[1] === "true" : true,
		studySettings: generatorParameters(props),
	};
}

// parse note entry
// any line starting with "- "
// return note with assigned properties
// must pass in a RegExpExecArray matched with the note pattern
export function parseNote(match: RegExpExecArray): Note {
	const note = {} as Note;

	note.listIndex = parseListIndex(match[2]);

	const { content, id } = getId(match[3]);
	note.content = content;
	if (note.content.endsWith(':')) {
		note.type = 'relation';
	} else if (pastedImageRegex.exec(note.content)) {
		note.type = 'image';
	} else {
		note.type = 'key word';
	}
	note.id = id;
  
	// parse the props string
	note.props = parseNoteProps(match[4]);
	return note;
}

export function getId(content: string): { content: string, id: string | null } {
	if (content.trim().endsWith('*')) {
		return {
			content: content.trim().slice(0, -1), 
			id: null
		}
	}
	
	const idTagMatch = idTagRegex.exec(content);
	if (idTagMatch) {
		content = content.slice(0, (idTagMatch as any).indices[0][0]);
		return {
			content: content.slice(0, (idTagMatch as any).indices[0][0]).trim(), 
			id: idTagMatch[0].slice(1)
		}
	} else {
		return {
			content: content.trim(), 
			id: ""
		}
	}
}

// parses contents (<props> group) of note tag
export function parseNoteProps(str: string): NoteProperties {
	const properties = createNoteProperties(true);
	const props = str.split(';');
	
	properties.path = parsePath(props[0]);
	properties.study = props[1] === "true";
	properties.card = properties.study ? parseCard(props.slice(2)) : null;

	return properties;
}

export function parsePath(str: string): string[] {
	return str.split('\\');
}

export function parseCard(props: string[]): Card {
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

export function studyable(content: string): boolean {
	const isRelation = /:$/.exec(content) != null; // content ends with ":"
	const containsClozes = /{.+?}/.test(content); // content includes clozes
	return !isRelation || containsClozes;
}

interface NoteType {
  keyWord: boolean;
  study: boolean;
}
export function noteType(content: string): NoteType {
  const type = {
    keyWord: true, 
    study: true, 
  }
  if (content.trim().endsWith(":")) {
    type.keyWord = false;
  }
  if (!type.keyWord) {
    const containsClozes = /{.+?}/.test(content);
    type.study = containsClozes;
  }
  return type;
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
	// if (title) {
	// 	// console.log(lowercase);
	// 	return lowercase;
	// }

	if (lowercase.length > NOTE_ID_MAX_LENGTH) {
		let result = "";
		let interval = (lowercase.length + 0.5) / NOTE_ID_MAX_LENGTH;
		for (let i = 0; i < lowercase.length; i += interval) {
			result += lowercase.charAt(i);
		}
		// console.log(result);
		return result;
	} else {
		// console.log(lowercase);
		return lowercase
	}
}

export function createNoteString(note: Note): string {
	let str = note.listIndex == 0 ? "- " : `${note.listIndex}. `;
	str += note.content;
	if (note.id == null) {
		str += "* ";
	} else if (note.id === "") {
		str += " ";
	} else {
		str += " #" + note.id + " ";
	}
	str += createNoteTag(note.props, true);
	return str;
}

export function createNoteTag(props: NoteProperties, includeTags: boolean): string {
	// console.log("createNoteTag(): props:", props);
	let string = includeTags ? noteTagOpen : "";

	// basic properties
	[ 
		toPathString(props.path),
		String(props.study), 
	].forEach(str => string += str + ';');

	// note does not have card, but needs one
	if (props.study && !props.card) props.card = createEmptyCard();

	// add card properties
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

	string += includeTags ? noteTagClose : "";
	return string;
}

// creates map tag
export function createMapTag(settings: MapSettings, includeTags = true): string {
	const propStrings: string[] = [
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
	let noteTagMatch = noteTagRegex.exec(text) as any;
	if (noteTagMatch) {
		text = text.substring(0, noteTagMatch.indices[0][0]);
	}
	let errorTagMatch = errorTagRegex.exec(text) as any;
	if (errorTagMatch) {
		text = text.substring(0, errorTagMatch.indices[0][0]);
	}
	return text.trim();
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