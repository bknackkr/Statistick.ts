import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { dbHelpers, hashId, cryptoHelpers } from './db';
import * as dotenv from 'dotenv';
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// In-memory tracker for voice session start times
const voiceSessions = new Map<string, number>();
const FOOTER_TEXT = "You can opt-out of tracking at any time with the command \"/opt-out true\".";

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user?.tag} - Statistick is online!`);
});

// --- TRACKING EVENTS ---

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const hashedId = await hashId(message.author.id);
    if (dbHelpers.isOptedOut(hashedId)) return;
    dbHelpers.ensureLookup(hashedId, message.author.id);

    const serverId = message.guild.id;
    const charCount = message.content.length;
    const attachmentCount = message.attachments.size;

    // Update User Stats
    dbHelpers.updateUserStat(hashedId, serverId, 'messages', 1);
    dbHelpers.updateUserStat(hashedId, serverId, 'characters', charCount);
    if (attachmentCount > 0) dbHelpers.updateUserStat(hashedId, serverId, 'attachments', attachmentCount);

    // Update Channel Stats
    dbHelpers.updateChannelStat(message.channel.id, serverId, 'messages', 1);
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || !reaction.message.guild) return;
    const hashedId = await hashId(user.id);
    if (dbHelpers.isOptedOut(hashedId)) return;

    dbHelpers.updateUserStat(hashedId, reaction.message.guild.id, 'reactions', 1);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.member || newState.member.user.bot || !newState.guild) return;

    const userId = newState.member.user.id;
    const hashedId = await hashId(userId);
    const serverId = newState.guild.id;

    if (dbHelpers.isOptedOut(hashedId)) return;

    // Joined a voice channel
    if (!oldState.channelId && newState.channelId) {
        voiceSessions.set(userId, Date.now());
        dbHelpers.updateUserStat(hashedId, serverId, 'voice_joins', 1);
        dbHelpers.updateChannelStat(newState.channelId, serverId, 'voice_joins', 1);
    }

    // Left a voice channel
    if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceSessions.get(userId);
        if (joinTime) {
            const timeSpentSeconds = Math.floor((Date.now() - joinTime) / 1000);
            dbHelpers.updateUserStat(hashedId, serverId, 'voice_time', timeSpentSeconds);
            dbHelpers.updateChannelStat(oldState.channelId, serverId, 'voice_time', timeSpentSeconds);
            voiceSessions.delete(userId);
        }
    }
});

// --- COMMAND HANDLING ---

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, guildId } = interaction;
    if (!guildId) return;

    if (commandName === 'opt-out') {
        const optOut = options.getBoolean('true') ?? true;
        const hashedId = await hashId(interaction.user.id);

        dbHelpers.setOptOut(hashedId, optOut);

        const embed = new EmbedBuilder()
            .setColor(optOut ? 'Red' : 'Green')
            .setTitle('Tracking Preferences Updated')
            .setDescription(optOut ? 'You have opted out. Your data has been wiped.' : 'You have opted back in. Tracking resumed.')
            .setFooter({ text: FOOTER_TEXT });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'user-stats') {
        const targetUser = options.getUser('user') || interaction.user;
        const mode = options.getString('type') || 'total'; // 'total' or 'average'
        const hashedId = await hashId(targetUser.id);

        if (dbHelpers.isOptedOut(hashedId)) {
            return interaction.reply({ content: 'This user has opted out of tracking.', ephemeral: true });
        }

        const stats = dbHelpers.getUserStats(hashedId, guildId);
        if (!stats) return interaction.reply({ content: 'No stats found for this user.', ephemeral: true });

        const embed = new EmbedBuilder().setColor('Blue').setFooter({ text: FOOTER_TEXT });

        if (mode === 'total') {
            embed.setTitle(`Total Stats for User`).setDescription(`ID Hash: \`${hashedId.substring(0, 10)}...\``)
                .addFields(
                    { name: 'Messages Sent', value: `${stats.messages}`, inline: true },
                    { name: 'Characters Typed', value: `${stats.characters}`, inline: true },
                    { name: 'Attachments', value: `${stats.attachments}`, inline: true },
                    { name: 'Reactions Added', value: `${stats.reactions}`, inline: true },
                    { name: 'Voice Joins', value: `${stats.voice_joins}`, inline: true },
                    { name: 'Voice Time (Seconds)', value: `${stats.voice_time}`, inline: true }
                );
        } else {
            const avgMsgLength = stats.messages > 0 ? (stats.characters / stats.messages).toFixed(2) : '0';
            const avgVcTime = stats.voice_joins > 0 ? (stats.voice_time / stats.voice_joins).toFixed(2) : '0';
            embed.setTitle(`Average Stats for User`)
                .addFields(
                    { name: 'Avg Message Length', value: `${avgMsgLength} chars/msg`, inline: true },
                    { name: 'Avg Time per Voice Session', value: `${avgVcTime} seconds`, inline: true }
                );
        }
        await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'server-stats') {
        const channel = options.getChannel('channel') || interaction.channel;
        // Type guard to safely grab the name if it exists, otherwise fallback
        const channelName = channel && 'name' in channel ? channel.name : 'Unknown Channel';
        const mode = options.getString('type') || 'total';
        const stats = dbHelpers.getChannelStats(channel!.id, guildId);

        if (!stats) return interaction.reply({ content: 'No stats found for this channel.', ephemeral: true });

        const embed = new EmbedBuilder().setColor('Purple').setFooter({ text: FOOTER_TEXT });

        if (mode === 'total') {
            embed.setTitle(`Total Stats for #${channelName}`)
                .addFields(
                    { name: 'Total Messages', value: `${stats.messages}`, inline: true },
                    { name: 'Voice Joins', value: `${stats.voice_joins}`, inline: true },
                    { name: 'Voice Time (Seconds)', value: `${stats.voice_time}`, inline: true }
                );
        } else {
            // Server averages calculated against total users isn't stored in a single column, 
            // but we can calculate time per join for the channel
            const avgVcTime = stats.voice_joins > 0 ? (stats.voice_time / stats.voice_joins).toFixed(2) : '0';
            embed.setTitle(`Average Stats for #${channelName}`)
                .addFields(
                    { name: 'Avg Time per Session Here', value: `${avgVcTime} seconds`, inline: true }
                );
        }
        await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'clear-server') {
        // Permission check
        if (!interaction.memberPermissions?.has('Administrator')) {
            return interaction.reply({ content: 'You must be an Administrator to use this.', ephemeral: true });
        }

        const confirmBtn = new ButtonBuilder().setCustomId('confirm_clear').setLabel('Yes, Clear All').setStyle(ButtonStyle.Danger);
        const cancelBtn = new ButtonBuilder().setCustomId('cancel_clear').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

        const response = await interaction.reply({
            content: 'Are you absolutely sure you want to clear ALL tracked data for this server?',
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 15000 });

        collector.on('collect', async i => {
            if (i.customId === 'confirm_clear') {
                dbHelpers.clearServer(guildId);
                await i.update({ content: 'All server data has been permanently cleared.', components: [] });
            } else {
                await i.update({ content: 'Operation cancelled.', components: [] });
            }
        });
    }
    if (commandName === 'anonymize') {
        const isAnon = options.getBoolean('true') ?? true;
        const realId = interaction.user.id;
        const hashedId = await hashId(realId);

        if (dbHelpers.isOptedOut(hashedId)) {
            return interaction.reply({ content: 'You are opted out. Your data is not on the leaderboard anyway.', ephemeral: true });
        }

        // Ensure they are in the lookup table before updating their preference
        dbHelpers.ensureLookup(hashedId, realId);
        dbHelpers.setAnonymize(hashedId, isAnon);

        const embed = new EmbedBuilder()
            .setColor(isAnon ? 'Grey' : 'Green')
            .setTitle('Anonymity Preferences Updated')
            .setDescription(isAnon ? 'You will now appear as **Anonymous** on the global leaderboard.' : 'Your username will now be visible on the leaderboard.')
            .setFooter({ text: FOOTER_TEXT });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'leaderboard') {
        // Example implementation of how to use the decrypted lookup
        const statCategory = options.getString('stat') || 'messages';
        const scope = options.getString('scope') || 'server'; // 'server' or 'global'
        const guildId = interaction.guildId!;

        const rows = dbHelpers.getLeaderboard(statCategory, scope, guildId);

        const embed = new EmbedBuilder()
            .setTitle(`${scope === 'global' ? 'Global' : 'Server'} Leaderboard: ${statCategory}`)
            .setColor('Gold')
            .setFooter({ text: FOOTER_TEXT });

        let description = '';

        // Loop through the top 10 users and decrypt their names if allowed
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let displayName = 'Unknown User';

            const lookup = dbHelpers.getLookup(row.hashed_user_id);

            if (lookup) {
                if (lookup.is_anonymous === 1) {
                    displayName = '*Anonymous*';
                } else {
                    try {
                        const decryptedId = cryptoHelpers.decryptId(lookup.encrypted_id, lookup.iv, lookup.auth_tag);
                        displayName = `<@${decryptedId}>`;
                    } catch (err) {
                        console.error('Failed to decrypt ID for hash:', row.hashed_user_id);
                        displayName = '*Corrupted Data*';
                    }
                }
            }

            description += `**${i + 1}.** ${displayName} - ${row.score}\n`;
        }

        embed.setDescription(description || 'No data available yet.');
        await interaction.reply({ embeds: [embed] });
    }
});

client.login(process.env.BOT_TOKEN);