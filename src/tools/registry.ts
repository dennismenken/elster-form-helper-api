import type { ToolDefinition } from "./envelope.js";
import { listFormsTool, listTaxTypesTool, listYearsTool } from "./discovery.js";
import {
  getFormOutlineTool,
  getFormTriggersTool,
  getPageTool,
  listPagesTool,
} from "./structure.js";
import { getLineTool, searchLinesTool } from "./lines.js";
import { getHelpSectionTool, searchHelpTool } from "./help.js";
import { validateValueTool } from "./validation.js";
import { recommendFormsTool } from "./recommendation.js";
import {
  sessionDeselectFormTool,
  sessionExportTool,
  sessionGetOpenQuestionsTool,
  sessionGetStatusTool,
  sessionImportTool,
  sessionSelectFormTool,
  sessionSetFieldTool,
  sessionSetProfileFieldTool,
  sessionSetProfileNoteTool,
  sessionStartTool,
} from "./sessions.js";

/**
 * Canonical, deterministic ordering of every tool the server exposes. The
 * order matters for `list_tools`: the MCP client (and the LLM) will read the
 * list top-to-bottom, so we group by lifecycle phase.
 */
export const ALL_TOOLS: readonly ToolDefinition[] = [
  listTaxTypesTool,
  listYearsTool,
  listFormsTool,

  getFormOutlineTool,
  getFormTriggersTool,
  listPagesTool,
  getPageTool,

  getLineTool,
  searchLinesTool,

  searchHelpTool,
  getHelpSectionTool,

  validateValueTool,
  recommendFormsTool,

  sessionStartTool,
  sessionSetProfileFieldTool,
  sessionSetProfileNoteTool,
  sessionSetFieldTool,
  sessionSelectFormTool,
  sessionDeselectFormTool,
  sessionGetStatusTool,
  sessionGetOpenQuestionsTool,
  sessionExportTool,
  sessionImportTool,
] as readonly ToolDefinition[];

export function findTool(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
