import { generatorParameters, createEmptyCard, FSRSParameters, Card } from "ts-fsrs";
import { MapProperties, NoteProperties, Note, MindMap } from "types";

export const notePattern = "- (?<content>.*?)<note>(?<props>.*?)<\/note>";
export const noteRegex = RegExp(notePattern, 'm');

export const noteTagPattern = "<note>(.*?)<\/note>";
export const noteTagRegex = RegExp(noteTagPattern, 'm');

export const mapTagPattern = "<map>(.*?)<\/map>";
export const mapTagRegex = RegExp(mapTagPattern, 'm');

export function parseMindMap(text: string): MindMap | null {
	const mindMap: MindMap = {
		map: {
			title: "title", 
      id: "", 
			studySettings: generatorParameters()
		}, 
		notes: []
	};

	const titlePattern = new RegExp("# (.*?)$", 'm');
	let titleMatch = titlePattern.exec(text);
  // console.log(titleMatch);
	if (!titleMatch) {
		console.log("Mind map title not found");
		return null;
	} else {
		mindMap.map.title = titleMatch[1];
    mindMap.map.id = toNoteID(titleMatch[1], true);
	}

	const mapPattern = new RegExp(mapTagPattern, 'gm');
	let mapMatch = mapPattern.exec(text);
	if (!mapMatch) {
		console.log("Study parameters not found");
		return null;
	} else {
		const params = parseStudyParameters(mapMatch[0]);
		mindMap.map.studySettings = params;
	}


	const noteRegex = new RegExp(notePattern, 'gm');
	let noteMatch;
	while ((noteMatch = noteRegex.exec(text)) !== null) {
		// console.log(noteMatch);
		const content = noteMatch[1].trim();
		const propsString = noteMatch[2];
		const props = parseNoteTag(propsString);
		mindMap.notes.push({ content, props });
	}

	return mindMap;
}

export function createNoteProperties(study: boolean): NoteProperties {
	return {
		path: [], 
		id: null, 
		study: study, 
		card: study ? createEmptyCard(Date.now()) : null, 
	}
}

export function createNote(study = false): Note {
  return {
    content: "", 
    props: createNoteProperties(study), 
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

	const note = createNote(false); 
	
	// extract the content string from the line
	const content = match[1];
	note.content = content ? content : "blank note";

	// parse the props string
	note.props = parseNoteTag(match[2]);
	return note;
}

// parses contents of note tag
export function parseNoteTag(str: string): NoteProperties {
	const properties = createNoteProperties(true);
	const props = str.split(';');
	
	properties.path = parsePath(props[0]);
	properties.id = props[1] ? props[1] : null;
	properties.study = props[2] === "true";
	properties.card = properties.study ? parseCard(props.slice(3)) : null;

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
export function toNoteID(str: string, title: boolean = false): string {
	const alphaNumeric = str.replace(/[^a-zA-Z0-9]/g, ''); 
	const lowercase = alphaNumeric.toLowerCase();
	if (title) {
		return lowercase;
	}
	return lowercase.substring(0, NOTE_ID_MAX_LENGTH);
}

export function toPathString(path: string[]): string {
	return path.join('\\');
}

export function formatPath(path: string[]): string {
	return path.join(' > ');
}

export function parseNumberArray(array: string): number[] {
  const splitString = array.split(',');
  return splitString.map((str) => parseFloat(str));
}
