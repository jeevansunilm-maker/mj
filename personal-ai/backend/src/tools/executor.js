// Runs a tool call from the AI: finds the tool, validates the input, runs it,
// and turns any failure into an error result the AI can read and recover from.
import { ToolInputError, validate } from "./validate.js";

export function createToolExecutor(tools) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async function execute(name, rawInput) {
    const tool = byName.get(name);
    if (!tool) return { name, input: rawInput, isError: true, result: { error: `Unknown tool "${name}"` } };
    let input = rawInput;
    if (typeof input === "string") {
      try { input = JSON.parse(input || "{}"); } catch { input = { INVALID_JSON: rawInput }; }
    }
    try {
      input = validate(tool.parameters, input ?? {});
      const { result, display } = await tool.run(input);
      return { name, input, result, display, isError: false };
    } catch (err) {
      const message = err instanceof ToolInputError ? `Invalid input: ${err.message}` : err.message;
      if (!(err instanceof ToolInputError)) console.error(`[tool ${name}]`, err);
      return { name, input, isError: true, result: { error: message }, display: { kind: "error", text: message } };
    }
  };
}
