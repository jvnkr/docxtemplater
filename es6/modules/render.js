const wrapper = require("../module-wrapper.js");
const {
	getScopeCompilationError,
	getCorruptCharactersException,
} = require("../errors.js");
const {
	utf8ToWord,
	hasCorruptCharacters,
	removeCorruptCharacters,
} = require("../doc-utils.js");

const {
	settingsContentType,
	coreContentType,
	appContentType,
	customContentType,
} = require("../content-types.js");

const ftprefix = {
	docx: "w",
	pptx: "a",
};

class Render {
	constructor() {
		this.name = "Render";
		this.recordRun = false;
		this.recordedRun = [];
	}
	optionsTransformer(options, docxtemplater) {
		this.parser = docxtemplater.parser;
		this.fileType = docxtemplater.fileType;
		return options;
	}
	set(obj) {
		if (obj.compiled) {
			this.compiled = obj.compiled;
		}
		if (obj.data != null) {
			this.data = obj.data;
		}
	}
	getRenderedMap(mapper) {
		return Object.keys(this.compiled).reduce((mapper, from) => {
			mapper[from] = { from, data: this.data };
			return mapper;
		}, mapper);
	}

	postparse(postparsed, options) {
		const errors = [];
		for (const p of postparsed) {
			if (p.type === "placeholder") {
				const tag = p.value;
				try {
					options.cachedParsers[p.lIndex] = this.parser(tag, { tag: p });
				} catch (rootError) {
					errors.push(
						getScopeCompilationError({ tag, rootError, offset: p.offset })
					);
				}
			}
		}
		return { postparsed, errors };
	}
	render(
		part,
		{
			contentType,
			scopeManager,
			linebreaks,
			nullGetter,
			fileType,
			stripInvalidXMLChars,
		}
	) {
		if (
			linebreaks &&
			[
				settingsContentType,
				coreContentType,
				appContentType,
				customContentType,
			].indexOf(contentType) !== -1
		) {
			// Fixes issue tested in #docprops-linebreak
			linebreaks = false;
		}
		if (linebreaks) {
			this.recordRuns(part);
		}
		if (part.type !== "placeholder" || part.module) {
			return;
		}
		let value;
		try {
			value = scopeManager.getValue(part.value, { part });
		} catch (e) {
			return { errors: [e] };
		}
		value ??= nullGetter(part);
		if (typeof value === "string") {
			if (stripInvalidXMLChars) {
				value = removeCorruptCharacters(value);
			} else if (
				["docx", "pptx", "xlsx"].indexOf(fileType) !== -1 &&
				hasCorruptCharacters(value)
			) {
				return {
					errors: [
						getCorruptCharactersException({
							tag: part.value,
							value,
							offset: part.offset,
						}),
					],
				};
			}
		}
		if (fileType === "text") {
			return { value };
		}
		return {
			value:
				linebreaks && typeof value === "string"
					? this.renderLineBreaks(value)
					: utf8ToWord(value),
		};
	}
	recordRuns(part) {
		if (part.tag === `${ftprefix[this.fileType]}:r`) {
			this.recordedRun = [];
		} else if (part.tag === `${ftprefix[this.fileType]}:rPr`) {
			if (part.position === "start") {
				this.recordRun = true;
				this.recordedRun = [part.value];
			}
			if (part.position === "end" || part.position === "selfclosing") {
				this.recordedRun.push(part.value);
				this.recordRun = false;
			}
		} else if (this.recordRun) {
			this.recordedRun.push(part.value);
		}
	}
	renderLineBreaks(value) {
		const p = ftprefix[this.fileType];
		const br = this.fileType === "docx" ? "<w:r><w:br/></w:r>" : "<a:br/>";
		const lines = value.split("\n");
		const runprops = this.recordedRun.join("");
		return lines
			.map((line) => utf8ToWord(line))
			.reduce((result, line, i) => {
				result.push(line);
				if (i < lines.length - 1) {
					result.push(
						`</${p}:t></${p}:r>${br}<${p}:r>${runprops}<${p}:t${
							this.fileType === "docx" ? ' xml:space="preserve"' : ""
						}>`
					);
				}
				return result;
			}, []);
	}
}

module.exports = () => wrapper(new Render());
