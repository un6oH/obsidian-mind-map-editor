import { generatorParameters, createEmptyCard, FSRSParameters, Card } from "ts-fsrs";
import { MapProperties, NoteProperties, Note, MindMap, MapSettings } from "types";

export const noteTagOpen = "%%note";
export const noteTagClose = "%%";
export const notePattern = `(?<list>[0-9]+\. |- )(?<content>.*?)${noteTagOpen}(?<props>.*?)${noteTagClose}`;
export const noteRegex = RegExp(notePattern, 'md');

export const noteTagPattern = `${noteTagOpen}(.*?)${noteTagClose}`;
export const noteTagRegex = RegExp(noteTagPattern, 'md');

export const mapTagOpen = "%%map";
export const mapTagClose = "%%";
export const mapTagPattern = `${mapTagOpen}(.*?)${mapTagClose}`;
export const mapTagRegex = RegExp(mapTagPattern, 'md');

export const pastedImagePattern = "\!\[\[Pasted image (.*?)\.png\]\]";
export const pastedImageRegex = RegExp(pastedImagePattern, 'md');

export const errorTagOpen = "%%error";
export const errorTagClose = "%%";
export const errorTagPattern = `${errorTagOpen}(?<type>\\d*)${errorTagClose}`;
export const errorTagRegex = RegExp(errorTagPattern, 'md');
export const errorPattern = `^.*(?<tag>${errorTagOpen}(?<type>\\d*)${errorTagClose})$`
export const errorRegex = RegExp(errorPattern, 'md');

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
export function parseNote(str: string): Note | null {;
	const match = noteRegex.exec(str);
	// console.log("propsTag:", propsTag ? propsTag : noteDataRegex.exec(string));
	if (!match) {
		return null;
	}

	const note = createBlankNote(); 
	
	// extract the content string from the line
	const content = match[2].trim();
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

export function listIndex(str: string): number {
	const parse = parseFloat(str);
	return isNaN(parse) ? 0 : parse;
}