/**
 * Skill metadata
 */
export interface SkillMetadata {
  /** Skill name (max 64 chars, lowercase letters, numbers, hyphens only) */
  name: string;
  /** Brief description of what the Skill does and when to use it (max 1024 chars) */
  description: string;
}

/**
 * Skill with its metadata and content
 */
export interface Skill {
  /** Skill metadata */
  metadata: SkillMetadata;
  /** Path to the Skill directory */
  skillPath: string;
  /** Path to the SKILL.md file */
  skillMdPath: string;
  /** Full content of SKILL.md (instructions) */
  instructions?: string;
  /** Whether the instructions have been loaded */
  instructionsLoaded: boolean;
}

/**
 * Validates Skill metadata according to Anthropic's requirements
 */
export function validateSkillMetadata(metadata: SkillMetadata): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate name
  if (!metadata.name) {
    errors.push("Skill name is required");
  } else {
    if (metadata.name.length > 64) {
      errors.push("Skill name must be 64 characters or less");
    }
    if (!/^[a-z0-9-]+$/.test(metadata.name)) {
      errors.push(
        "Skill name must contain only lowercase letters, numbers, and hyphens",
      );
    }
    if (
      metadata.name.includes("anthropic") || metadata.name.includes("claude")
    ) {
      errors.push(
        "Skill name cannot contain reserved words: 'anthropic' or 'claude'",
      );
    }
    if (metadata.name.includes("<") || metadata.name.includes(">")) {
      errors.push("Skill name cannot contain XML tags");
    }
  }

  // Validate description
  if (!metadata.description) {
    errors.push("Skill description is required");
  } else {
    if (metadata.description.length > 1024) {
      errors.push("Skill description must be 1024 characters or less");
    }
    if (
      metadata.description.includes("<") || metadata.description.includes(">")
    ) {
      errors.push("Skill description cannot contain XML tags");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
