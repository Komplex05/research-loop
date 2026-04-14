import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Research a topic using Claude and return a markdown summary.
 * @param {string} topic - The topic to research
 * @returns {Promise<string>} Markdown-formatted research result
 */
export async function research(topic) {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Research the following topic and provide a thorough, well-structured summary in Markdown format. Include key findings, recommendations, and any important caveats.\n\nTopic: ${topic}`,
      },
    ],
  });

  return message.content[0].text;
}
