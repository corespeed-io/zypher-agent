import { join, resolve } from "@std/path";
import { exists } from "@std/fs";
import type { Skill, SkillMetadata } from "./Skill.ts";
import { validateSkillMetadata } from "./Skill.ts";
import type { ZypherContext } from "../ZypherAgent.ts";

/**
 * Manages Agent Skills discovery and loading
 */
export class SkillManager {
  readonly #context: ZypherContext;
  readonly #skillsDir: string;
  #skills: Map<string, Skill> = new Map();

  constructor(
    context: ZypherContext,
    skillsDir?: string,
  ) {
    this.#context = context;
    // Default to ./.skills/ in the working directory
    this.#skillsDir = resolve(
      this.#context.workingDirectory,
      skillsDir ?? "./.skills",
    );
  }

  /**
   * Gets the Skills directory path
   */
  get skillsDir(): string {
    return this.#skillsDir;
  }

  /**
   * Discovers all Skills from the Skills directory
   */
  async discoverSkills(): Promise<void> {
    this.#skills.clear();

    if (!(await exists(this.#skillsDir))) {
      return;
    }

    try {
      for await (const entry of Deno.readDir(this.#skillsDir)) {
        if (!entry.isDirectory) {
          continue;
        }

        const skillPath = join(this.#skillsDir, entry.name);
        const skillMdPath = join(skillPath, "SKILL.md");

        if (!(await exists(skillMdPath))) {
          console.warn(
            `Skill directory ${entry.name} does not contain SKILL.md, skipping`,
          );
          continue;
        }

        // Parse Skill metadata
        try {
          const skill = await this.#loadSkillMetadata(skillPath, skillMdPath);
          if (skill) {
            this.#skills.set(skill.metadata.name, skill);
          }
        } catch (error) {
          console.warn(
            `Failed to load Skill ${entry.name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      console.warn(
        `Failed to discover Skills from ${this.#skillsDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Loads Skill metadata
   */
  async #loadSkillMetadata(
    skillPath: string,
    skillMdPath: string,
  ): Promise<Skill | null> {
    const content = await Deno.readTextFile(skillMdPath);
    const metadata = this.#parseFrontmatter(content);

    if (!metadata) {
      console.warn(`Failed to parse frontmatter from ${skillMdPath}`);
      return null;
    }

    const validation = validateSkillMetadata(metadata);
    if (!validation.valid) {
      console.warn(
        `Invalid Skill metadata in ${skillMdPath}: ${
          validation.errors.join(", ")
        }`,
      );
      return null;
    }

    return {
      metadata,
      skillPath,
      skillMdPath,
      instructionsLoaded: false,
    };
  }

  /**
   * Parses YAML frontmatter from SKILL.md
   */
  #parseFrontmatter(content: string): SkillMetadata | null {
    // Try to match YAML frontmatter
    const frontmatter = content.match(
      /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/,
    );

    if (frontmatter) {
      const frontmatterText = frontmatter[1];
      const nameMatch = frontmatterText.match(/^name:\s*(.+?)$/m);
      const descriptionMatch = frontmatterText.match(/^description:\s*(.+?)$/m);

      if (!nameMatch || !descriptionMatch) {
        return null;
      }

      const name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      const description = descriptionMatch[1].trim().replace(
        /^["']|["']$/g,
        "",
      );

      return { name, description };
    }

    return null;
  }

  /**
   * Gets all discovered Skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.#skills.values());
  }

  /**
   * Gets a specific Skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.#skills.get(name);
  }

  /**
   * Loads the instructions (Level 2) for a Skill
   */
  async loadSkillInstructions(skillName: string): Promise<string | null> {
    const skill = this.#skills.get(skillName);
    if (!skill) {
      return null;
    }

    // Return cached instructions if already loaded
    if (skill.instructionsLoaded && skill.instructions) {
      return skill.instructions;
    }

    try {
      const content = await Deno.readTextFile(skill.skillMdPath);

      // Extract body
      const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
      const instructions = bodyMatch ? bodyMatch[1].trim() : content.trim();

      skill.instructions = instructions;
      skill.instructionsLoaded = true;

      return instructions;
    } catch (error) {
      console.warn(
        `Failed to load instructions for Skill ${skillName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Gets Skill metadata formatted for system prompt inclusion
   * The Agent will decide which Skills to use based on the metadata
   */
  getSkillsMetadataForPrompt(): string {
    const skills = this.getAllSkills();
    if (skills.length === 0) {
      return "";
    }

    const skillDescriptions = skills.map(
      (skill) => `- **${skill.metadata.name}**: ${skill.metadata.description}`,
    ).join("\n");

    return `
<agent_skills>
**MANDATORY TASK INITIATION STEP**: Before starting any task, you MUST check whether relevant Agent Skills are available. Agent Skills define reusable, domain-specific capabilities. If relevant Skills are listed below, you MUST load their instructions using the 'load_skill_instructions' tool BEFORE doing anything else. This step is REQUIRED.

**Available Agent Skills:**

${skillDescriptions}

---

**REQUIRED EXECUTION WORKFLOW — Apply this to EVERY task:**

1. **IMMEDIATELY upon receiving a user request**: 
   - Review the Skill descriptions above.

2. **IF ANY Skill description matches or partially overlaps the task**:  
   - You MUST call 'load_skill_instructions' with that Skill’s name BEFORE proceeding.

3. **After loading Skill instructions**:
   - Carefully review all provided guidance and the list of optional resources (scripts, markdown files, templates, etc.).

4. **When a resource is mentioned or required** (e.g., “see REFERENCE.md”):  
   - Use 'load_skill_resource' to load that specific file ON DEMAND — do not pre-load everything.

5. **Follow the Skill’s instruction file** ('SKILL.md') and any loaded resources precisely to complete the task.

6. **NEVER SKIP Skill loading or relevant resource reading**:  
   - If a Skill applies, using it is mandatory — not optional.

---

**ABOUT AGENT SKILLS:**
- Skills are structured packages that contain:
  - A main instruction file ('SKILL.md')
  - Optional markdown guides, scripts, or resource files (loaded only when needed)
- They enable Zypher to specialize in specific tasks while preserving context
- Instructions are loaded in tiers:
  - Level 1: Metadata (Skill name, description) — always loaded
  - Level 2: Instructions (from 'SKILL.md') — load with 'load_skill_instructions'
  - Level 3: Resources — load with 'load_skill_resource' when needed

---

**GUIDELINES FOR USING RESOURCES:**
- Only load resources when they are required for understanding or completing the task (e.g., 'REFERENCE.md')

---

**EXAMPLES OF SKILL USAGE:**
- User requests PDF operations → Load "pdf-processing" Skill → If 'SKILL.md' mentions 'FORMS.md', load that too
- User wants spreadsheet work → Load "excel-processing" → If there's a helper script, execute it when needed instead of loading upfront unless you need to read it
- User asks for summarizing docs → Load "docx-summary" or related → Load markdown instructions if referenced
- Any domain-specific match → Load that Skill, then required resources

---

**REMEMBER**:
- Skill use is **non-optional** when a match is found
- Skill instructions MUST be reviewed before proceeding
- Resources are **optional and contextual** — only load them as needed
- This workflow ensures modular, efficient, and specialized task completion

</agent_skills>
`;
  }
}
