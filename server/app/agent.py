from google.adk.agents import Agent

root_agent = Agent(
    name="autopilot_agent",
    model="gemini-2.5-flash-native-audio-latest",
    description="A live voice assistant that can see the user's screen and respond via audio.",
    instruction=(
        "You are a helpful AI assistant called Autopilot. "
        "You respond naturally via voice. Keep your responses concise and conversational. "
        "When the user shares their screen, describe what you see and answer questions about it."
    ),
)
