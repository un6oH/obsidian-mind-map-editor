import { generatorParameters, createEmptyCard, FSRSParameters, Card } from "ts-fsrs";
import { MapProperties, NoteProperties, Note, MindMap } from "types";

export const noteTagOpen = "%%note";
export const noteTagClose = "%%";
export const notePattern = `(?<list>[0-9]+\.|-)(?<content>.*?)${noteTagOpen}(?<props>.*?)${noteTagClose}`;
export const noteRegex = RegExp(notePattern, 'm');

export const noteTagPattern = `${noteTagOpen}(.*?)${noteTagClose}`;
export const noteTagRegex = RegExp(noteTagPattern, 'm');

export const mapTagOpen = "%%map";
export const mapTagClose = "%%";
export const mapTagPattern = `${mapTagOpen}(.*?)${mapTagClose}`;
export const mapTagRegex = RegExp(mapTagPattern, 'm');

export const pastedImagePattern = "\!\[\[Pasted image (.*?)\.png\]\]";
export const pastedImageRegex = RegExp(pastedImagePattern, 'm');

export const errorTagOpen = "%%error";
export const errorTagClose = "%%";
export const errorTagPattern = `^.*(?<tag>${errorTagOpen}(?<type>\\d*)${errorTagClose})$`

export function parseMindMap(text: string): MindMap | null {
	const mindMap: MindMap = {
		map: {
			title: "title", 
      id: "", 
			studySettings: generatorParameters()
		}, 
		notes: []
	};

	// title
	const titlePattern = new RegExp("# (.*?)$", 'm');
	let titleMatch = titlePattern.exec(text);
  // console.log(titleMatch);
	if (!titleMatch) {
		console.log("Mind map title not found");
		return null;
	} else {
		mindMap.map.title = titleMatch[1];
    mindMap.map.id = toNoteID(titleMatch[1], false);
	}

	// map settings
	const mapPattern = new RegExp(mapTagPattern, 'gm');
	let mapMatch = mapPattern.exec(text);
	if (!mapMatch) {
		console.log("Study parameters not found");
		return null;
	} else {
		const params = parseStudyParameters(mapMatch[0]);
		mindMap.map.studySettings = params;
	}

	// note patterns
	const noteRegex = new RegExp(notePattern, 'gm');
	let noteMatch;
	while ((noteMatch = noteRegex.exec(text)) !== null) {
		// console.log(noteMatch);
		const content = noteMatch[2].trim();
		const propsString = noteMatch[3];
		const props = parseNoteTag(propsString);
		props.listIndex = listIndex(noteMatch[1]); // override index
		mindMap.notes.push({ content, props });
	}

	// chain notes

	return mindMap;
}

export function createNoteProperties(study: boolean): NoteProperties {
	return {
		path: [], 
		id: null, 
		study: study, 
		listIndex: 0, 
		card: study ? createEmptyCard(Date.now()) : null, 
	}
}

export function createBlankNote(): Note {
  return {
    content: "", 
    props: createNoteProperties(false), 
  }
}

// parses <map></map> tag
export function parseStudyParameters(string: string): FSRSParameters {
	const contents = string.slice(5, -6);
	const parameters = string.trim().split(';');
	const props: Partial<FSRSParameters> = {
		enable_fuzz: parameters[0] !== "" ? parameters[0] === "true" : undefined, 
		enable_short_term: parameters[1] !== "" ? parameters[1] === "true" : undefined, 
		maximum_interval: parameters[2] !== "" ? parseFloat(parameters[2]) : undefined, 
		request_retention: parameters[3] !== "" ? parseFloat(parameters[3]) : undefined, 
		w: parameters[4] !== "" ? parseNumberArray(parameters[4]) : undefined, 
	};
	return generatorParameters(props);
}

// parse note entry
// any line starting with "- "
// return note with assigned properties
export function parseNote(str: string): Note | null {
	const string = str.trim();
  // const noteRegex = new RegExp(notePattern, 'd');
	const match = noteRegex.exec(string);
	// console.log("propsTag:", propsTag ? propsTag : noteDataRegex.exec(string));
	if (!match) {
		return null;
	}

	const note = createBlankNote(); 
	
	// extract the content string from the line
	const content = match[2];
	note.content = content ? content : "blank note";

	// parse the props string
	note.props = parseNoteTag(match[3]);
	return note;
}

// parses contents (<props> group) of note tag
export function parseNoteTag(str: string): NoteProperties {
	const properties = createNoteProperties(true);
	const props = str.split(';');
	
	properties.path = parsePath(props[0]);
	properties.id = props[1] ? props[1] : null;
	properties.listIndex = parseFloat(props[2]);
	properties.study = props[3] === "true";
	properties.card = properties.study ? parseCard(props.slice(4)) : null;

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

	if (lowercase.length > 12) {
		let result = "";
		let interval = (lowercase.length + 0.5) / 12;
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

export function createNoteTag(props: NoteProperties, includeTags: boolean): string {
	// console.log("createNoteTag(): props:", props);
	let string = includeTags ? noteTagOpen : "";
	const propStrings: string[] = [
		toPathString(props.path), 
		props.id ? props.id : "", 
		props.listIndex.toString(),
		String(props.study), 
	];
	propStrings.forEach(str => string += str + ';');

	if (props.study && !props.card) 
		props.card = createEmptyCard();
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
export function createMapTag(params: FSRSParameters, includeTags = true): string {
	let string = "";
	const propStrings = [
		params.enable_fuzz.toString(), 
		params.enable_short_term.toString(), 
		params.maximum_interval.toString(),
		params.request_retention.toString(), 
		params.w.join(','), 
	]
	propStrings.forEach(str => string += str + ';');

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

export function listIndex(str: string): number {
	const parse = parseFloat(str);
	return isNaN(parse) ? 0 : parse;
}