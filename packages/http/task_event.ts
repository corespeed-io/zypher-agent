import type { TaskEvent as AgentTaskEvent } from "@zypher/agent";
import { filter, Observable, ReplaySubject } from "rxjs";

// Re-export shared leaf types from @zypher/types
export type {
  CustomErrorEvent,
  ErrorEvent,
  HeartbeatEvent,
  StandardErrorEvent,
} from "@zypher/types";
import type { ErrorEvent, HeartbeatEvent } from "@zypher/types";

/**
 * HTTP task event — uses the concrete HttpTaskEventId class (not the interface
 * from @zypher/types) so that handler code can call static methods like `.generate()`.
 */
export type HttpTaskEvent =
  & (AgentTaskEvent | HeartbeatEvent | ErrorEvent)
  & {
    eventId: HttpTaskEventId;
  };

/**
 * Represents a unique identifier for task events with timestamp and sequence components.
 * Format: task_<timestamp>_<sequence>
 */
export class HttpTaskEventId {
  // Static state to maintain uniqueness across instances
  static #lastTimestamp: number = 0;
  static #currentSequence: number = 0;
  #timestamp: number;
  #sequence: number;
  #raw: string;

  /**
   * Private constructor - use HttpTaskEventId.parse() or HttpTaskEventId.generate() instead
   * @param rawId The string representation of the ID in format task_<timestamp>_<sequence>
   * @param timestamp The timestamp component
   * @param sequence The sequence component
   */
  private constructor(rawId: string, timestamp: number, sequence: number) {
    this.#raw = rawId;
    this.#timestamp = timestamp;
    this.#sequence = sequence;
  }

  /**
   * Parses a string into a HttpTaskEventId
   * @param rawId The string representation of the ID in format task_<timestamp>_<sequence>
   * @throws Error if the format is invalid
   * @returns A HttpTaskEventId instance
   */
  static parse(rawId: string): HttpTaskEventId {
    const match = rawId.match(/^task_(\d+)_(\d+)$/);

    if (!match) {
      throw new Error(
        `Invalid event ID format: ${rawId}. Expected format: task_<timestamp>_<sequence>`,
      );
    }

    const timestamp = parseInt(match[1], 10);
    const sequence = parseInt(match[2], 10);
    return new HttpTaskEventId(rawId, timestamp, sequence);
  }

  /**
   * Safely parses a string into a HttpTaskEventId without throwing exceptions
   * @param rawId The string representation of the ID
   * @returns The HttpTaskEventId if valid, null otherwise
   */
  static safeParse(rawId: string): HttpTaskEventId | null {
    const match = rawId.match(/^task_(\d+)_(\d+)$/);
    if (!match) {
      return null;
    }

    const timestamp = parseInt(match[1], 10);
    const sequence = parseInt(match[2], 10);
    return new HttpTaskEventId(rawId, timestamp, sequence);
  }

  /**
   * Creates a new HttpTaskEventId with the current timestamp and an appropriate sequence number
   */
  static generate(): HttpTaskEventId {
    return HttpTaskEventId.generateWithTimestamp(Date.now());
  }

  /**
   * Creates a new HttpTaskEventId with the specified timestamp and an appropriate sequence number
   * This is primarily useful for testing or when you need to create an ID with a specific timestamp
   */
  static generateWithTimestamp(timestamp: number): HttpTaskEventId {
    // Keep track of last timestamp and sequence for uniqueness
    if (timestamp === HttpTaskEventId.#lastTimestamp) {
      HttpTaskEventId.#currentSequence++;
    } else {
      HttpTaskEventId.#lastTimestamp = timestamp;
      HttpTaskEventId.#currentSequence = 0;
    }

    const raw = `task_${timestamp}_${HttpTaskEventId.#currentSequence}`;
    return new HttpTaskEventId(
      raw,
      timestamp,
      HttpTaskEventId.#currentSequence,
    );
  }

  /**
   * Returns the raw string representation of the ID
   */
  toString(): string {
    return this.#raw;
  }

  /**
   * Custom JSON serialization - returns the string representation
   */
  toJSON(): string {
    return this.#raw;
  }

  /**
   * Checks if this event ID is chronologically after another event ID
   * @param other The other HttpTaskEventId to compare with
   * @returns true if this event occurred after the other event
   */
  isAfter(other: HttpTaskEventId): boolean {
    if (this.#timestamp > other.#timestamp) {
      return true;
    }

    return this.#timestamp === other.#timestamp &&
      this.#sequence > other.#sequence;
  }

  /**
   * Gets the timestamp component of the ID
   */
  get timestamp(): number {
    return this.#timestamp;
  }

  /**
   * Gets the sequence component of the ID
   */
  get sequence(): number {
    return this.#sequence;
  }
}

/**
 * Adds heartbeat events to an Observable during periods of inactivity
 * @template T The type of events in the source Observable
 * @param source The source Observable
 * @param heartbeatInterval The interval in milliseconds to wait before emitting a heartbeat
 * @param createHeartbeatFn Function to create a heartbeat event
 * @returns An Observable that includes the original events plus heartbeat events
 */
export function withHeartbeat<T>(
  source: Observable<T>,
  heartbeatInterval: number,
  createHeartbeatFn: () => T,
): Observable<T> {
  return new Observable<T>((observer) => {
    let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

    // Function to schedule the next heartbeat
    const scheduleHeartbeat = () => {
      // Clear any existing timeout
      if (heartbeatTimeout !== null) {
        clearTimeout(heartbeatTimeout);
      }

      // Schedule a new heartbeat
      heartbeatTimeout = setTimeout(() => {
        const heartbeatEvent = createHeartbeatFn();
        observer.next(heartbeatEvent);

        // Schedule the next heartbeat
        scheduleHeartbeat();
      }, heartbeatInterval);
    };

    // Start the heartbeat scheduling
    scheduleHeartbeat();

    // Subscribe to the source and forward events
    const subscription = source.subscribe({
      next: (event) => {
        // Forward the event
        observer.next(event);

        // Reset the heartbeat timer
        scheduleHeartbeat();
      },
      error: (err) => {
        if (heartbeatTimeout !== null) {
          clearTimeout(heartbeatTimeout);
        }
        observer.error(err);
      },
      complete: () => {
        if (heartbeatTimeout !== null) {
          clearTimeout(heartbeatTimeout);
        }
        observer.complete();
      },
    });

    // Return cleanup function
    return () => {
      subscription.unsubscribe();
      if (heartbeatTimeout !== null) {
        clearTimeout(heartbeatTimeout);
      }
    };
  });
}

/**
 * Converts an Observable to a ReplaySubject that will replay all events to new subscribers
 * @template T The type of events in the source Observable
 * @param source The source Observable
 * @returns A ReplaySubject that replays all events to new subscribers
 */
export function withReplay<T>(source: Observable<T>): ReplaySubject<T> {
  const subject = new ReplaySubject<T>();

  // Subscribe the subject directly to the source
  source.subscribe(subject);

  return subject;
}

/**
 * Creates a task heartbeat event
 * @returns A heartbeat HttpTaskEvent
 */
export function createTaskHeartbeat(): HttpTaskEvent {
  return {
    type: "heartbeat",
    timestamp: Date.now(),
    eventId: HttpTaskEventId.generate(),
  };
}

/**
 * Creates a ReplaySubject from an Observable that emits heartbeat events during periods of inactivity
 * @param source The source Observable of HttpTaskEvent objects
 * @param heartbeatInterval The interval in milliseconds to wait before emitting a heartbeat
 * @returns A ReplaySubject that replays all events including added heartbeats
 */
export function withHttpTaskEventReplayAndHeartbeat(
  source: Observable<HttpTaskEvent>,
  heartbeatInterval: number,
): ReplaySubject<HttpTaskEvent> {
  // First add heartbeat events, then convert to a ReplaySubject
  return withReplay(
    withHeartbeat(source, heartbeatInterval, createTaskHeartbeat),
  );
}

/**
 * Filters events from a ReplaySubject to replay only events that occurred after
 * a specified event ID (if provided) and filters out stale pending approval events.
 *
 * @param source The ReplaySubject containing the events to replay
 * @param serverLatestEventId The ID of the most recent event produced by the server at the moment
 * when this function is called. This is used to filter out stale pending approval events.
 * Stale pending approval events are those that occurred after the clientLastEventId but before the serverLatestEventId.
 * @param clientLastEventId The ID of the last event that was received by the client
 * @returns An Observable that emits only events that occurred after the specified event ID
 */
export function replayHttpTaskEvents(
  source: ReplaySubject<HttpTaskEvent>,
  serverLatestEventId?: HttpTaskEventId,
  clientLastEventId?: HttpTaskEventId,
): Observable<HttpTaskEvent> {
  return source
    .asObservable()
    .pipe(
      // First filter: only include events after clientLastEventId (if provided)
      filter((event) =>
        clientLastEventId ? event.eventId.isAfter(clientLastEventId) : true
      ),
      // Second filter: filter out stale pending approval events
      filter((event) => {
        // Only apply this filter to tool_approval_pending events when serverLatestEventId is provided
        if (serverLatestEventId && event.type === "tool_use_pending_approval") {
          // Create HttpTaskEventId objects for comparison
          const eventId = event.eventId;

          // Keep the event if it's newer than or equal to the server's latest event
          // (i.e., filter out stale pending approval events that happened before the server's latest event)
          return !serverLatestEventId.isAfter(eventId);
        }
        // Keep all other event types
        return true;
      }),
    );
}
