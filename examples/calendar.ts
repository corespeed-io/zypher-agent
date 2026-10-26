/**
 * Example: Calendar Agent
 *
 * Demonstrates custom tools and MCP server integration.
 * This example creates a calendar management agent with:
 * - Custom appointment tools (CRUD operations)
 * - Custom timezone tools
 * - PostgreSQL MCP server for database operations
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - (required) Your Anthropic API key
 *   POSTGRES_URL      - (required) PostgreSQL connection string
 *   ZYPHER_MODEL      - (optional) Model to use, defaults to "claude-sonnet-5-5"
 *
 * Run:
 *   deno run --env -A examples/calendar.ts
 */

import { createZypherAgent, getSystemPrompt } from "@zypher/agent";
import { createTool } from "@zypher/agent/tools";
import { runAgentInTerminal } from "@zypher/cli";
import { getRequiredEnv } from "@zypher/utils/env";
import { z } from "zod";

// ============================================================================
// Appointment Tools
// ============================================================================

const DB_FILE = "./appointments.json";

type Appointment = {
  id: string;
  title: string;
  datetime: string;
  timezone: string;
  location?: string;
  description?: string;
};

async function loadAppointments(): Promise<Appointment[]> {
  try {
    const text = await Deno.readTextFile(DB_FILE);
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function saveAppointments(appts: Appointment[]) {
  await Deno.writeTextFile(DB_FILE, JSON.stringify(appts, null, 2));
}

const addAppointmentTool = createTool({
  name: "appointment_add",
  description: "Create a new appointment.",
  schema: z.object({
    title: z.string().describe("Appointment title"),
    datetime: z.string().describe(
      "ISO 8601 datetime string (with or without timezone)",
    ),
    timezone: z.string().describe("IANA timezone for the datetime"),
    location: z.string().optional(),
    description: z.string().optional(),
  }),
  execute: async ({ title, datetime, timezone, location, description }) => {
    const appointments = await loadAppointments();
    const id = crypto.randomUUID();
    const newAppt: Appointment = {
      id,
      title,
      datetime,
      timezone,
      location,
      description,
    };
    appointments.push(newAppt);
    await saveAppointments(appointments);
    return JSON.stringify(newAppt);
  },
});

const getAppointmentTool = createTool({
  name: "appointment_get",
  description:
    "Retrieve appointment(s). Provide an `id` to get a single appointment or omit to list all.",
  schema: z.object({
    id: z.string().describe("Unique appointment ID").optional(),
  }),
  execute: async ({ id }) => {
    const appointments = await loadAppointments();
    if (id) {
      const appt = appointments.find((a) => a.id === id);
      if (!appt) {
        throw new Error(`Appointment with id ${id} not found.`);
      }
      return JSON.stringify(appt);
    }
    return JSON.stringify(appointments);
  },
});

const editAppointmentTool = createTool({
  name: "appointment_edit",
  description: "Edit fields of an existing appointment by `id`.",
  schema: z.object({
    id: z.string().describe("Unique appointment ID"),
    title: z.string().describe("New title").optional(),
    datetime: z.string().describe(
      "New ISO 8601 datetime (with or without timezone)",
    ).optional(),
    timezone: z.string().describe("IANA timezone for the new datetime")
      .optional(),
    location: z.string().optional(),
    description: z.string().optional(),
  }),
  execute: async (params) => {
    const { id, ...updates } = params;
    const appointments = await loadAppointments();
    const idx = appointments.findIndex((a) => a.id === id);
    if (idx === -1) {
      throw new Error(`Appointment with id ${id} not found.`);
    }
    appointments[idx] = { ...appointments[idx], ...updates };
    await saveAppointments(appointments);
    return JSON.stringify(appointments[idx]);
  },
});

const deleteAppointmentTool = createTool({
  name: "appointment_delete",
  description: "Delete an appointment by `id`.",
  schema: z.object({
    id: z.string().describe("Unique appointment ID"),
  }),
  execute: async ({ id }) => {
    const appointments = await loadAppointments();
    const idx = appointments.findIndex((a) => a.id === id);
    if (idx === -1) {
      throw new Error(`Appointment with id ${id} not found.`);
    }
    const [removed] = appointments.splice(idx, 1);
    await saveAppointments(appointments);
    return JSON.stringify(removed);
  },
});

// ============================================================================
// Timezone Tools
// ============================================================================

const currentTimeTool = createTool({
  name: "current_time",
  description:
    "Return the current timestamp and the runtime's local timezone. No parameters required.",
  schema: z.object({}),
  execute: () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    return Promise.resolve(
      JSON.stringify({
        iso: now.toISOString(),
        timezone: tz,
        localized: now.toLocaleString("en-US", {
          timeZone: tz,
          timeZoneName: "short",
        }),
      }),
    );
  },
});

const timezoneConvertTool = createTool({
  name: "timezone_convert",
  description: `Convert a timestamp from one timezone to another.
- \`time\` can be any ISO-8601-compatible string. If it does not contain an explicit timezone or offset, the local runtime timezone will be assumed.
- \`output_timezone\` is optional; if omitted, the local runtime timezone will be used.`,
  schema: z.object({
    time: z.string().describe(
      "ISO 8601 timestamp. If timezone/offset omitted, local timezone is assumed",
    ),
    output_timezone: z.string().describe(
      "IANA timezone name for the desired output, e.g. Europe/London",
    ).optional(),
  }),
  execute: ({ time, output_timezone }) => {
    const inputDate = new Date(time);
    if (isNaN(inputDate.valueOf())) {
      throw new Error(
        "Invalid date format. Must be ISO 8601 format, e.g. 2024-03-25T15:30:00Z",
      );
    }
    const tz = output_timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    return Promise.resolve(
      inputDate.toLocaleString("en-US", {
        timeZone: tz,
        timeZoneName: "short",
      }),
    );
  },
});

// ============================================================================
// Main
// ============================================================================

const SYSTEM_PROMPT =
  `You are a calendar agent. Your job is to help the user manage their itinerary and daily schedule. The user will ask you to:

1. Set up an appointment
2. Check the time arrangement for a specific appointment
3. Change appointments
4. Delete appointments
5. Convert times between timezones`;

const model = Deno.env.get("ZYPHER_MODEL") ?? "claude-sonnet-5-5";
const postgresUrl = getRequiredEnv("POSTGRES_URL");

console.log(`Using model: ${model}`);
console.log(`PostgreSQL: ${postgresUrl.replace(/:[^@]+@/, ":***@")}\n`);

const agent = await createZypherAgent({
  model,
  overrides: {
    systemPromptLoader: () =>
      getSystemPrompt(Deno.cwd(), { customInstructions: SYSTEM_PROMPT }),
  },
  tools: [
    currentTimeTool,
    timezoneConvertTool,
    addAppointmentTool,
    getAppointmentTool,
    editAppointmentTool,
    deleteAppointmentTool,
  ],
  mcpServers: [
    {
      id: "postgres",
      type: "command",
      command: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgresql", postgresUrl],
      },
    },
  ],
});

await runAgentInTerminal(agent);
