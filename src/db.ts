import Database from 'better-sqlite3';
import * as argon2 from 'argon2';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const db = new Database('statistick.db');

// Initialize Tables
db.exec(`
    CREATE TABLE IF NOT EXISTS UserStats (
        hashed_user_id TEXT,
        server_id TEXT,
        messages INTEGER DEFAULT 0,
        characters INTEGER DEFAULT 0,
        attachments INTEGER DEFAULT 0,
        reactions INTEGER DEFAULT 0,
        voice_joins INTEGER DEFAULT 0,
        voice_time INTEGER DEFAULT 0,
        PRIMARY KEY (hashed_user_id, server_id)
    );
    CREATE TABLE IF NOT EXISTS ChannelStats (
        channel_id TEXT,
        server_id TEXT,
        messages INTEGER DEFAULT 0,
        voice_joins INTEGER DEFAULT 0,
        voice_time INTEGER DEFAULT 0,
        PRIMARY KEY (channel_id, server_id)
    );
    CREATE TABLE IF NOT EXISTS OptOut (
        hashed_user_id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS UserLookup (
        hashed_user_id TEXT PRIMARY KEY,
        encrypted_id TEXT,
        iv TEXT,
        auth_tag TEXT,
        is_anonymous INTEGER DEFAULT 0
    );
`);

// Crypto Configuration
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || '12345678901234567890123456789012');
if (ENCRYPTION_KEY.length !== 32) throw new Error('ENCRYPTION_KEY must be exactly 32 bytes.');

export const cryptoHelpers = {
    encryptId: (discordId: string) => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(discordId, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');

        return { encrypted, iv: iv.toString('hex'), authTag };
    },
    decryptId: (encryptedHex: string, ivHex: string, authTagHex: string): string => {
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
};

// Argon2 Deterministic Hashing
const STATIC_SALT = Buffer.from(process.env.HASH_SECRET || 'default_secret_salt_32_bytes_long!');

export async function hashId(userId: string): Promise<string> {
    // raw: true returns a Buffer, which we convert to hex for DB storage
    const hashBuffer = await argon2.hash(userId, { salt: STATIC_SALT, raw: true });
    return hashBuffer.toString('hex');
}

export const dbHelpers = {
    isOptedOut: (hashedId: string) => {
        const stmt = db.prepare('SELECT 1 FROM OptOut WHERE hashed_user_id = ?');
        return !!stmt.get(hashedId);
    },
    setOptOut: (hashedId: string, optOut: boolean) => {
        if (optOut) {
            db.prepare('INSERT OR IGNORE INTO OptOut (hashed_user_id) VALUES (?)').run(hashedId);
            db.prepare('DELETE FROM UserStats WHERE hashed_user_id = ?').run(hashedId);
        } else {
            db.prepare('DELETE FROM OptOut WHERE hashed_user_id = ?').run(hashedId);
        }
    },
    updateUserStat: (hashedId: string, serverId: string, stat: string, amount: number = 1) => {
        db.prepare(`
            INSERT INTO UserStats (hashed_user_id, server_id, ${stat}) 
            VALUES (?, ?, ?) 
            ON CONFLICT(hashed_user_id, server_id) 
            DO UPDATE SET ${stat} = ${stat} + ?
        `).run(hashedId, serverId, amount, amount);
    },
    updateChannelStat: (channelId: string, serverId: string, stat: string, amount: number = 1) => {
        db.prepare(`
            INSERT INTO ChannelStats (channel_id, server_id, ${stat}) 
            VALUES (?, ?, ?) 
            ON CONFLICT(channel_id, server_id) 
            DO UPDATE SET ${stat} = ${stat} + ?
        `).run(channelId, serverId, amount, amount);
    },
    getUserStats: (hashedId: string, serverId: string) => {
        return db.prepare('SELECT * FROM UserStats WHERE hashed_user_id = ? AND server_id = ?').get(hashedId, serverId) as any;
    },
    getChannelStats: (channelId: string, serverId: string) => {
        return db.prepare('SELECT * FROM ChannelStats WHERE channel_id = ? AND server_id = ?').get(channelId, serverId) as any;
    },
    clearServer: (serverId: string) => {
        db.prepare('DELETE FROM UserStats WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM ChannelStats WHERE server_id = ?').run(serverId);
    },
    ensureLookup: (hashedId: string, realId: string) => {
        // Only encrypt and store if we don't already have them in the lookup table
        const exists = db.prepare('SELECT 1 FROM UserLookup WHERE hashed_user_id = ?').get(hashedId);
        if (!exists) {
            const { encrypted, iv, authTag } = cryptoHelpers.encryptId(realId);
            db.prepare(`
                INSERT INTO UserLookup (hashed_user_id, encrypted_id, iv, auth_tag) 
                VALUES (?, ?, ?, ?)
            `).run(hashedId, encrypted, iv, authTag);
        }
    },
    setAnonymize: (hashedId: string, isAnon: boolean) => {
        // Ensure they exist in the lookup table first, or this update will do nothing
        db.prepare('UPDATE UserLookup SET is_anonymous = ? WHERE hashed_user_id = ?').run(isAnon ? 1 : 0, hashedId);
    },
    getLookup: (hashedId: string) => {
        return db.prepare('SELECT * FROM UserLookup WHERE hashed_user_id = ?').get(hashedId) as {
            encrypted_id: string, iv: string, auth_tag: string, is_anonymous: number
        } | undefined;
    },
    getLeaderboard: (stat: string, scope: string, serverId: string) => {
        // Whitelist the stat variable to prevent SQL injection
        const validStats = ['messages', 'characters', 'voice_time'];
        if (!validStats.includes(stat)) return [];

        if (scope === 'server') {
            return db.prepare(`SELECT hashed_user_id, ${stat} as score FROM UserStats WHERE server_id = ? ORDER BY ${stat} DESC LIMIT 10`).all(serverId) as any[];
        } else {
            return db.prepare(`SELECT hashed_user_id, SUM(${stat}) as score FROM UserStats GROUP BY hashed_user_id ORDER BY score DESC LIMIT 10`).all() as any[];
        }
    }
};