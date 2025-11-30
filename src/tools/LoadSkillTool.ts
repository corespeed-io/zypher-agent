import { z } from "zod";
import { createTool, type Tool, type ToolResult } from "./mod.ts";
import type { SkillManager } from "../skills/mod.ts";

/**
 * Creates a tool that allows the Agent to load Skill instructions on-demand
 *
 * @param skillManager The SkillManager instance to use for loading instructions
 * @returns A tool that can load Skill instructions
 */
export function createLoadSkillTool(
  skillManager: SkillManager,
): Tool<{
  skillName: string;
  explanation?: string | undefined;
}> {
  return createTool({
    name: "load_skill_instructions",
    description:
      `Load the full instructions for an Agent Skill. Use this when you need detailed guidance from a Skill that was mentioned in the available Skills list.

First, review the available Skills from the system prompt. When you determine a Skill is relevant to the task, call this tool to load its complete instructions. The instructions will be returned and you can then follow them to complete the task.

Only load Skills that are actually relevant to the current task to keep context efficient.`,
    schema: z.object({
      skillName: z
        .string()
        .describe(
          "The name of the Skill to load instructions for (must match exactly with the Skill name from the available Skills list)",
        ),
      explanation: z
        .string()
        .optional()
        .describe(
          "One sentence explanation as to why you are loading this Skill and how it will help with the task.",
        ),
    }),
    execute: async (
      { skillName },
    ): Promise<ToolResult> => {
      // Check if Skill exists
      const skill = skillManager.getSkill(skillName);
      if (!skill) {
        return {
          content: [{
            type: "text",
            text: `Skill "${skillName}" not found. Available Skills: ${
              skillManager.getAllSkills().map((s) => s.metadata.name).join(", ")
            }`,
          }],
        };
      }

      // Load the instructions (this also discovers resources)
      const instructions = await skillManager.loadSkillInstructions(skillName);

      if (!instructions) {
        return {
          content: [{
            type: "text",
            text: `Failed to load instructions for Skill "${skillName}"`,
          }],
        };
      }

      // Return the instructions
      return {
        content: [{
          type: "text",
          text:
            `Loaded instructions for Skill: ${skillName}\n\n${instructions}`,
        }],
      };
    },
  });
}
