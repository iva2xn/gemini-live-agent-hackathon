import asyncio
from google import genai
from google.genai import types

async def mock_tool(arg: str):
    """This is a mock tool."""
    print(f"Mock tool called with {arg}")
    return f"Result of {arg}"

async def main():
    client = genai.Client()
    chat = client.aio.chats.create(
        model="gemini-2.5-flash",
        config=types.GenerateContentConfig(
            tools=[mock_tool],
            temperature=0.0
        )
    )
    res = await chat.send_message("Call mock tool with 'hello'")
    print("Final response:", res.text)

if __name__ == "__main__":
    asyncio.run(main())
