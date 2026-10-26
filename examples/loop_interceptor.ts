/**
 * Example: Loop Interceptors
 *
 * Demonstrates how to create custom loop interceptors to control the agent loop.
 * This example uses a "Haiku Validator" that checks if the LLM's response follows
 * the 5-7-5 syllable pattern and asks it to retry if not.
 *
 * Key concepts:
 * - Creating custom interceptors with the LoopInterceptor interface
 * - Controlling the loop with { complete: true } (exit) vs { complete: false } (continue)
 * - Injecting feedback via the reason field (auto-injected as user message)
 *
 * Run:
 *   deno run --env --allow-read --allow-net --allow-env --allow-sys examples/loop_interceptor.ts
 */

import { createZypherAgent, type LoopInterceptor } from "@zypher/agent";
import { eachValueFrom } from "rxjs-for-await";
import chalk from "chalk";

/**
 * Simple syllable counter using a vowel-based heuristic.
 *
 * Note: This is approximate and may miscount words with silent vowels,
 * diphthongs, or unusual spellings (e.g., "programming" may count as 3 instead of 4).
 * For production use, consider a dictionary-based approach like CMU Pronouncing Dictionary.
 */
function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length === 0) return 0;

  // Handle silent 'e' at the end
  if (word.endsWith("e") && word.length > 2) {
    word = word.slice(0, -1);
  }

  // Count vowel groups
  const vowelGroups = word.match(/[aeiouy]+/g);
  return vowelGroups ? vowelGroups.length : 1;
}

/** Counts the total syllables in a line of text. */
function countLineSyllables(line: string): number {
  const words = line.split(/\s+/).filter((w) => w.length > 0);
  return words.reduce((sum, word) => sum + countSyllables(word), 0);
}

/** Extracts 3 consecutive haiku lines from the LLM response, or null if not found. */
function extractHaikuLines(response: string): string[] | null {
  // Try to find 3 lines that look like a haiku
  const lines = response.split("\n").filter((line) => {
    const trimmed = line.trim();
    // Skip empty lines and lines that look like markdown or explanations
    return trimmed.length > 0 &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("-") &&
      !trimmed.startsWith("*") &&
      !trimmed.includes(":") &&
      trimmed.length < 100;
  });

  // Look for 3 consecutive poetic lines
  for (let i = 0; i <= lines.length - 3; i++) {
    const candidate = lines.slice(i, i + 3);
    // Check if this looks like a haiku (each line has some words)
    if (candidate.every((line) => line.trim().split(/\s+/).length >= 2)) {
      return candidate.map((l) => l.trim());
    }
  }

  return null;
}

/**
 * Creates a haiku validator interceptor.
 *
 * This interceptor checks if the LLM's response contains a valid haiku
 * (5-7-5 syllable pattern). If not, it returns feedback asking the LLM
 * to try again.
 */
function haikuValidator(): LoopInterceptor {
  return {
    name: "haiku_validator",
    description: "Validates haiku syllable pattern (5-7-5)",

    intercept(context) {
      const { lastResponse } = context;

      // Extract haiku lines from the response
      const lines = extractHaikuLines(lastResponse);

      if (!lines) {
        console.log(chalk.yellow("\n[Validator] Could not find haiku lines"));
        return {
          complete: false,
          reason:
            "I couldn't identify the haiku lines in your response. Please write a haiku with exactly 3 lines, each on its own line, without any additional formatting or explanation.",
        };
      }

      // Count syllables for each line
      const syllableCounts = lines.map(countLineSyllables);
      const [first, second, third] = syllableCounts;

      console.log(chalk.cyan("\n[Validator] Analyzing haiku:"));
      lines.forEach((line, i) => {
        const count = syllableCounts[i];
        const expected = [5, 7, 5][i];
        const status = count === expected
          ? chalk.green(`OK`)
          : chalk.red(`WRONG`);
        console.log(chalk.dim(`  Line ${i + 1}: "${line}"`));
        console.log(
          chalk.dim(
            `         ${count} syllables (expected ${expected}) ${status}`,
          ),
        );
      });

      // Check if valid 5-7-5 pattern
      if (first === 5 && second === 7 && third === 5) {
        console.log(chalk.green("[Validator] Valid haiku! Pattern: 5-7-5"));
        return { complete: true };
      }

      // Invalid pattern - ask for retry
      const feedback =
        `Your haiku has syllable counts of ${first}-${second}-${third}, but a haiku must follow the 5-7-5 pattern. ` +
        `Please revise:\n` +
        `- Line 1 needs ${
          5 - first > 0 ? `${5 - first} more` : `${first - 5} fewer`
        } syllable${Math.abs(5 - first) !== 1 ? "s" : ""}\n` +
        `- Line 2 needs ${
          7 - second > 0 ? `${7 - second} more` : `${second - 7} fewer`
        } syllable${Math.abs(7 - second) !== 1 ? "s" : ""}\n` +
        `- Line 3 needs ${
          5 - third > 0 ? `${5 - third} more` : `${third - 5} fewer`
        } syllable${Math.abs(5 - third) !== 1 ? "s" : ""}`;

      console.log(
        chalk.yellow(
          `[Validator] Invalid pattern: ${first}-${second}-${third}`,
        ),
      );
      console.log(chalk.yellow("[Validator] Asking LLM to retry...\n"));

      return {
        complete: false,
        reason: feedback,
      };
    },
  };
}

/** Runs the haiku validator example. */
async function main() {
  const model = Deno.env.get("ZYPHER_MODEL") ?? "claude-sonnet-5-5";

  console.log(
    chalk.bold("\n=== Loop Interceptor Example: Haiku Validator ===\n"),
  );
  console.log(chalk.dim(`Using model: ${model}`));
  console.log(chalk.dim("Interceptor: haikuValidator()"));
  console.log(chalk.dim("Max iterations: 5 (to prevent infinite loops)\n"));

  // Create agent with custom interceptor
  // Note: executeTools() is automatically prepended by the factory
  // Use config.maxIterations to limit retries (built-in safety mechanism)
  const agent = await createZypherAgent({
    model,
    interceptors: [
      haikuValidator(),
    ],
    config: {
      maxIterations: 5, // Limit retries to prevent infinite loops
    },
  });

  // Run the task
  const events$ = agent.runTask(
    `Write a haiku about programming.

IMPORTANT: A haiku must have exactly 3 lines with a 5-7-5 syllable pattern:
- Line 1: exactly 5 syllables
- Line 2: exactly 7 syllables
- Line 3: exactly 5 syllables

Output ONLY the haiku, with each line on its own line. No titles, no explanations.`,
  );

  const textEncoder = new TextEncoder();

  try {
    for await (const event of eachValueFrom(events$)) {
      if (event.type === "text") {
        await Deno.stdout.write(textEncoder.encode(event.content));
      }
    }

    console.log(chalk.green("\n\nTask completed."));
  } catch (error) {
    console.error(chalk.red("\nError:"), error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
