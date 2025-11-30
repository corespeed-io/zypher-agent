import * as z from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Base interface for tool parameters
 */
export type BaseParams = Record<string, unknown>;

/**
 * Execution context provided to tools
 */
export interface ToolExecutionContext {
  workingDirectory: string;
}

/**
 * The result of a tool execution
 */
export type ToolResult = CallToolResult | string;

/**
 * Base interface for all tools
 */
export interface Tool<P extends BaseParams = BaseParams> {
  /**
   * The name of the tool
   */
  readonly name: string;

  /**
   * A description of what the tool does
   */
  readonly description: string;

  /**
   * The JSON schema for the tool's parameters
   */
  readonly parameters: InputSchema;

  /**
   * Execute the tool with the given parameters
   */
  execute(
    params: P,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult>;
}

/**
 * [JSON schema](https://json-schema.org/draft/2020-12) for this tool's input.
 *
 * This defines the shape of the `input` that your tool accepts and that the model
 * will produce.
 */
export interface InputSchema {
  type: "object";
  properties?: unknown | null;
  required?: Array<string> | null;
  [k: string]: unknown;
}

type InferParams<T extends z.ZodType> = z.infer<T>;

/**
 * Helper function to create a tool with a simpler API
 */
export function createTool<T extends z.ZodObject<z.ZodRawShape>>(options: {
  name: string;
  description: string;
  schema: T;
  execute: (
    params: InferParams<T>,
    ctx: ToolExecutionContext,
  ) => Promise<ToolResult>;
}): Tool<InferParams<T>> {
  // Convert Zod schema to JSON Schema
  const jsonSchema = z.toJSONSchema(options.schema);

  return {
    name: options.name,
    description: options.description,
    parameters: jsonSchema as InputSchema,
    execute: async (
      params: InferParams<T>,
      ctx: ToolExecutionContext,
    ) => {
      // Validate params using Zod schema
      const validatedParams = await options.schema.parseAsync(params);
      return options.execute(validatedParams, ctx);
    },
  };
}

// Tool exports
export { ReadFileTool } from "./ReadFileTool.ts";
export { ListDirTool } from "./ListDirTool.ts";
export { createEditFileTools } from "./EditFileTool.ts";
export { RunTerminalCmdTool } from "./RunTerminalCmdTool.ts";
export { GrepSearchTool } from "./GrepSearchTool.ts";
export { FileSearchTool } from "./FileSearchTool.ts";
export { CopyFileTool, DeleteFileTool } from "./FileTools.ts";
export { createImageTools } from "./ImageTools.ts";
export { createLoadSkillTool } from "./LoadSkillTool.ts";
