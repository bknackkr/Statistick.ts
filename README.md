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
Now cd into src/, then run `npx ts-node deploy.ts` to have Discord register the slash commands, then `npx ts-node index.ts` to actually run the bot. Don't ask me why, ask gemini why it did such a stupid system.

## Add it to your server
If you don't want to hassle with running the bot yourself, or want to add to the global leaderboard, you can add my hosted version to your server [here](https://discord.com/oauth2/authorize?client_id=1465169218801504256&permissions=8&integration_type=0&scope=bot+applications.commands).
