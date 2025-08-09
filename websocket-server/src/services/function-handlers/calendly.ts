import { envs } from "../../configs";
import { FunctionHandler } from "../../interfaces";

export const scheduleCalendlyMeeting: FunctionHandler = {
  schema: {
    name: "schedule_calendly_meeting",
    type: "function",
    description: "Schedule a meeting using Calendly",
    parameters: {
      type: "object",
      properties: {
        eventType: {
          type: "string",
          description: "Calendly event type URI (e.g., 'https://api.calendly.com/event_types/AAAAAAAAAAAAAAAA')"
        },
        startTime: {
          type: "string",
          description: "Start time in ISO format (e.g., '2024-01-15T10:00:00Z')"
        },
        inviteeEmail: {
          type: "string",
          description: "Email of the person being invited"
        },
        inviteeName: {
          type: "string",
          description: "Name of the person being invited"
        },
        timezone: {
          type: "string",
          description: "Timezone (e.g., 'America/Sao_Paulo')"
        },
      },
      required: ["eventType", "startTime", "inviteeEmail", "inviteeName"]
    }
  },
  handler: async (args: {
    eventType: string;
    startTime: string;
    inviteeEmail: string;
    inviteeName: string;
    timezone?: string;
    questions?: Array<{ question: string; answer: string }>;
  }) => {
    try {
      const response = await fetch('https://api.calendly.com/scheduled_events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${envs.CALENDLY_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          event_type: args.eventType,
          start_time: args.startTime,
          invitee: {
            email: args.inviteeEmail,
            name: args.inviteeName,
            timezone: args.timezone || 'UTC'
          },
          questions_and_responses: args.questions?.map(q => ({
            question: q.question,
            response: q.answer
          })) || []
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Calendly API Error: ${errorData.message || response.statusText}`);
      }
      const data = await response.json();
      return JSON.stringify({
        success: true,
        eventId: data.resource.uri,
        meetingLink: data.resource.location?.join_url || data.resource.location?.location,
        startTime: data.resource.start_time,
        endTime: data.resource.end_time,
        status: data.resource.status,
        invitee: {
          name: args.inviteeName,
          email: args.inviteeEmail
        }
      });
    } catch (error) {
      console.error('Error creating Calendly meeting:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }
};

