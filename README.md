# Statistick.ts
Slop coded shitty Discord bot I threw together in like 30 mins on a whim. Tracks messages sent, total characters, voice time, etc.

## Installation
If, for whatever reason, you want to use this AI slop code and host this bot yourself you need to install the dependencies, then create a .env file in src/ like so:
```
BOT_TOKEN=[Token]
CLIENT_ID=[Application ID]
HASH_SECRET=[32 Character Random String]
ENCRYPTION_KEY=[Different 32 Character Random String]
```
then run `npx ts-node deploy.ts` to have Discord register the slash commands, then `npx ts-node index.ts` to actually run the bot. Don't ask me why, ask gemini why it did such a stupid system.
