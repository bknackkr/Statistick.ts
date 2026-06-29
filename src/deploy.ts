import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
dotenv.config();

const commands = [
    new SlashCommandBuilder()
        .setName('user-stats')
        .setDescription('Shows user stats in an embed')
        .addUserOption(option => option.setName('user').setDescription('The user to check'))
        .addStringOption(option => option.setName('type').setDescription('Total or average').addChoices(
            { name: 'Total', value: 'total' },
            { name: 'Average', value: 'average' }
        )),
    new SlashCommandBuilder()
        .setName('server-stats')
        .setDescription('Shows channel specific stats')
        .addChannelOption(option => option.setName('channel').setDescription('The channel to check'))
        .addStringOption(option => option.setName('type').setDescription('Total or average').addChoices(
            { name: 'Total', value: 'total' },
            { name: 'Average', value: 'average' }
        )),
    new SlashCommandBuilder()
        .setName('opt-out')
        .setDescription('Opt in or out of data tracking')
        .addBooleanOption(option => option.setName('true').setDescription('True to opt-out, False to opt-in').setRequired(true)),
    new SlashCommandBuilder()
        .setName('clear-server')
        .setDescription('Admin only: Clears all server data')
        .setDefaultMemberPermissions(8), // Administrator bitfield
    new SlashCommandBuilder()
        .setName('anonymize')
        .setDescription('Hide your username on the global leaderboard')
        .addBooleanOption(option =>
            option.setName('true')
                .setDescription('True to become Anonymous, False to show your name')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the top users for a specific stat')
        .addStringOption(option =>
            option.setName('scope')
                .setDescription('Server or Global leaderboard')
                .addChoices(
                    { name: 'Server', value: 'server' },
                    { name: 'Global', value: 'global' }
                )
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('stat')
                .setDescription('The stat to view')
                .addChoices(
                    { name: 'Messages Sent', value: 'messages' },
                    { name: 'Characters Typed', value: 'characters' },
                    { name: 'Voice Time', value: 'voice_time' }
                )
                .setRequired(true)
        ),
];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN!);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID!),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();