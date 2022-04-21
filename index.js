//////////////////////////////////////////
//////////////// LOGGING /////////////////
//////////////////////////////////////////
function getCurrentDateString() {
    return (new Date()).toISOString() + ' ::';
};
__originalLog = console.log;
console.log = function () {
    var args = [].slice.call(arguments);
    __originalLog.apply(console.log, [getCurrentDateString()].concat(args));
};
//////////////////////////////////////////
//////////////////////////////////////////

const fs = require('fs');
const util = require('util');
const path = require('path');
const { Readable } = require('stream');

//////////////////////////////////////////
///////////////// VARIA //////////////////
//////////////////////////////////////////

function necessary_dirs() {
    if (!fs.existsSync('./data/')){
        fs.mkdirSync('./data/');
    }
}
necessary_dirs()

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function convert_audio(input) {
    try {
        // stereo to mono channel
        const data = new Int16Array(input)
        const ndata = data.filter((el, idx) => idx % 2);
        return Buffer.from(ndata);
    } catch (e) {
        console.log(e)
        console.log('convert_audio: ' + e)
        throw e;
    }
}
//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////


//////////////////////////////////////////
//////////////// CONFIG //////////////////
//////////////////////////////////////////

const SETTINGS_FILE = 'settings-sample.json';

let DISCORD_TOK = null;
let WITAI_TOK = null; 
let SPEECH_METHOD = 'vosk'; // witai, google, vosk

function loadConfig() {
    if (fs.existsSync(SETTINGS_FILE)) {
        const CFG_DATA = JSON.parse( fs.readFileSync(SETTINGS_FILE, 'utf8') );
        DISCORD_TOK = CFG_DATA.DISCORD_TOK;
        WITAI_TOK = CFG_DATA.WITAI_TOK;
        SPEECH_METHOD = CFG_DATA.SPEECH_METHOD;
    }
    DISCORD_TOK = process.env.DISCORD_TOK || DISCORD_TOK;
    WITAI_TOK = process.env.WITAI_TOK || WITAI_TOK;
    SPEECH_METHOD = process.env.SPEECH_METHOD || SPEECH_METHOD;

    if (!['witai', 'google', 'vosk'].includes(SPEECH_METHOD))
        throw 'invalid or missing SPEECH_METHOD'
    if (!DISCORD_TOK)
        throw 'invalid or missing DISCORD_TOK'
    if (SPEECH_METHOD === 'witai' && !WITAI_TOK)
        throw 'invalid or missing WITAI_TOK'
    if (SPEECH_METHOD === 'google' && !fs.existsSync('./gspeech_key.json'))
        throw 'missing gspeech_key.json'
    
}
loadConfig()

const https = require('https')
function listWitAIApps(cb) {
    const options = {
      hostname: 'api.wit.ai',
      port: 443,
      path: '/apps?offset=0&limit=100',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer '+WITAI_TOK,
      },
    }

    const req = https.request(options, (res) => {
      res.setEncoding('utf8');
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
      });
      res.on('end',function() {
        cb(JSON.parse(body))
      })
    })

    req.on('error', (error) => {
      console.error(error)
      cb(null)
    })
    req.end()
}
function updateWitAIAppLang(appID, lang, cb) {
    const options = {
      hostname: 'api.wit.ai',
      port: 443,
      path: '/apps/' + appID,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer '+WITAI_TOK,
      },
    }
    const data = JSON.stringify({
      lang
    })

    const req = https.request(options, (res) => {
      res.setEncoding('utf8');
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
      });
      res.on('end',function() {
        cb(JSON.parse(body))
      })
    })
    req.on('error', (error) => {
      console.error(error)
      cb(null)
    })
    req.write(data)
    req.end()
}

//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////


const Discord = require('discord.js')
const { Client} = require('discord.js');
const DISCORD_MSG_LIMIT = 2000;
const discordClient = new Client()
if (process.env.DEBUG)
    discordClient.on('debug', console.debug);
discordClient.on('ready', () => {
    console.log(`Logged in as ${discordClient.user.tag}!`)
})
discordClient.login(DISCORD_TOK)

const PREFIX = '!';
const _CMD_HELP        = PREFIX + 'help';
const _CMD_JOIN        = PREFIX + 'join';
const _CMD_LEAVE       = PREFIX + 'leave';
const _CMD_SOUNDLIST   = PREFIX + 'sounds';
const _CMD_HERE        = PREFIX + 'here';
const _CMD_PLAY        = PREFIX + 'play';
const _CMD_UPLOAD      = PREFIX + 'upload';
const _CMD_RENAME      = PREFIX + 'rename';
const _CMD_ADDPSEUDONYM = PREFIX + 'addpseudo';
const _CMD_SHOWPSEUDONYM = PREFIX + 'showpseudo';
const _CMD_DELETEPSEUDONYM = PREFIX + 'deletepseudo';
const _CMD_DELETESOUND = PREFIX + 'deletesound';

const guildMap = new Map();


discordClient.on('message', async (msg) => {
    try {
        if (!('guild' in msg) || !msg.guild) return; // prevent private messages to bot
        const mapKey = msg.guild.id;
        if (msg.content.trim().toLowerCase() == _CMD_JOIN) {
            if (!msg.member.voice.channelID) {
                msg.reply('Error: please join a voice channel first.')
            } else {
                if (!guildMap.has(mapKey))
                    await connect(msg, mapKey)
                else
                    msg.reply('Already connected')
            }
        } else if (msg.content.trim().toLowerCase() == _CMD_LEAVE) {
            if (guildMap.has(mapKey)) {
                let val = guildMap.get(mapKey);
                if (val.voice_Channel) val.voice_Channel.leave()
                if (val.voice_Connection) val.voice_Connection.disconnect()
                guildMap.delete(mapKey)
                msg.reply("Disconnected.")
            } else {
                msg.reply("Cannot leave because not connected.")
            }
        } else if (msg.content.trim().toLowerCase() == _CMD_HELP) {
            msg.reply(getHelpString());
        }
        else if (msg.content.trim().toLowerCase() == _CMD_SOUNDLIST) 
            await sounds(msg);
        else if (msg.content.trim().toLowerCase() == _CMD_HERE)
            await here(msg);
        else if (msg.content.trim().startsWith(_CMD_PLAY))
            await play(msg);
        else if (msg.content.trim().toLowerCase() == _CMD_UPLOAD)
            upload(msg);
        else if (msg.content.trim().startsWith(_CMD_RENAME))
            await rename(msg);
        else if (msg.content.trim().startsWith(_CMD_ADDPSEUDONYM))
            await add_pseudo(msg);
        else if (msg.content.trim().startsWith(_CMD_SHOWPSEUDONYM))
            await show_pseudo(msg);
        else if (msg.content.trim().startsWith(_CMD_DELETEPSEUDONYM))
            await delete_pseudo(msg);
        else if (msg.content.trim().startsWith(_CMD_DELETESOUND))
            await delete_sound(msg);
    } catch (e) {
        console.log('discordClient message: ' + e)
        msg.reply('Error#180: Something went wrong, try again or contact the developers if this keeps happening.');
    }
})

function getHelpString() {
    let out = '\n' + PREFIX + 'join' + ' - connect bot to your voice channel\n';
    out += PREFIX + 'leave' + ' - disconnect bot from voice channel\n';
    out += PREFIX + 'here' + ' - just a ready check\n';
    out += PREFIX + 'sounds' + ' - print a sound list\n';
    out += PREFIX + 'play soundName || number' + ' - play the sound from sound list with given name or number\n';
    out += PREFIX + 'upload' + ' - upload given mp3 attachments\n';
    out += PREFIX + 'rename oldSoundName newSoundName' + ' - rename sound from the first name to the second\n';
    out += PREFIX + 'addpseudo soundName 1Pseudonym 2Pseudonym ...' + ' - add pseudonyms to sound, pseudonyms used to spot on which words bot will trigger sound\n';
    out += PREFIX + 'showpseudo soundName' + ' - show sounds pseudonyms\n';
    out += PREFIX + 'deletepseudo soundName 1Pseudonym 2Pseudonym ...' + ' - removes given pseudonyms from list\n';
    return out;
}

const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
    this.destroy();
  }
}

let voice_Connection;

async function connect(msg, mapKey) {
    try {
        let voice_Channel = await discordClient.channels.fetch(msg.member.voice.channelID);
        if (!voice_Channel) return msg.reply("Error: The voice channel does not exist!");
        let text_Channel = await discordClient.channels.fetch(msg.channel.id);
        if (!text_Channel) return msg.reply("Error: The text channel does not exist!");
        voice_Connection = await voice_Channel.join();
        voice_Connection.play(new Silence(), { type: 'opus' });
        guildMap.set(mapKey, {
            'text_Channel': text_Channel,
            'voice_Channel': voice_Channel,
            'voice_Connection': voice_Connection,
            'selected_lang': 'en',
            'debug': false,
        });
        speak_impl(voice_Connection, mapKey)
        voice_Connection.on('disconnect', async(e) => {
            if (e) console.log(e);
            guildMap.delete(mapKey);
        })
        msg.reply('connected!')
    } catch (e) {
        console.log('connect: ' + e)
        msg.reply('Error: unable to join your voice channel.');
        throw e;
    }
}

const vosk = require('vosk');
MODEL_PATH = 'vosk_models/en';
const model = new vosk.Model(MODEL_PATH);
let recs = new vosk.Recognizer({ model: model, sampleRate: 48000 });
let is_recognizer_need_to_reload = false;
vosk.setLogLevel(-1);
setTimeout(() => is_recognizer_need_to_reload = true, 30000);
function reload_recognizer() {
    recs.free();
    recs = new vosk.Recognizer({ model: model, sampleRate: 48000 });
    is_recognizer_need_to_reload = false;
    setTimeout(() => is_recognizer_need_to_reload = true, 30000);
    console.log('in reload recognizer');
}


function speak_impl(voice_Connection, mapKey) {
    voice_Connection.on('speaking', async (user, speaking) => {
        if (speaking.bitfield == 0 || user.bot) {
            return
        }
        console.log(`I'm listening to ${user.username}`)
        // this creates a 16-bit signed PCM, stereo 48KHz stream
        const audioStream = voice_Connection.receiver.createStream(user, { mode: 'pcm' })
        audioStream.on('error',  (e) => { 
            console.log('audioStream: ' + e)
        });
        let buffer = [];
        audioStream.on('data', (data) => {
            buffer.push(data)
        })
        audioStream.on('end', async () => {
            buffer = Buffer.concat(buffer)
            const duration = buffer.length / 48000 / 4;
            console.log("duration: " + duration)

            if (SPEECH_METHOD === 'witai' || SPEECH_METHOD === 'google') {
            if (duration < 1.0 || duration > 19) { // 20 seconds max dur
                console.log("TOO SHORT / TOO LONG; SKPPING")
                return;
            }
            }

            try {
                let new_buffer = await convert_audio(buffer)
                let out = await transcribe(new_buffer, mapKey);
                if (out != null)
                    process_commands_query(out, mapKey, user);
            } catch (e) {
                console.log('tmpraw rename: ' + e)
            }


        })
    })
}

function process_commands_query(txt, mapKey, user) {
    if (txt && txt.length) {
        let val = guildMap.get(mapKey);
        voice_command_processing(txt, user);
    }
}


//////////////////////////////////////////
//////////////// SPEECH //////////////////
//////////////////////////////////////////
async function transcribe(buffer, mapKey) {
  if (SPEECH_METHOD === 'vosk') {
      recs.acceptWaveform(buffer);
      let ret = recs.result().text;
      console.log('vosk:', ret);
      if (is_recognizer_need_to_reload)
          reload_recognizer();
      return ret;
  }
}

//MY FUNCTIONS

let soundList = [];
updateSoundList();

function is_connected(msg) {
    const mapKey = msg.guild.id;
    if (!guildMap.has(mapKey))
        return false;
    return true;
}
function updateSoundList() {
    soundList = fs.readdirSync("\sounds");
    for (i = 0; i < soundList.length; ++i) {
        soundList[i] = soundList[i].slice(0, -4);
    }
}

async function here(msg) {
    await msg.channel.send("I'm here");
}

function is_str_in_col(str, collection) {
    for (i = 0; i < collection.length; ++i) {
        if (collection[i] === str)
            return true;
    }
    return false;
}
async function play(msg) {
    updateSoundList();
    let soundName = msg.content.trim().slice(6);
    if (is_str_in_col(soundName, soundList)) {
        if (!is_connected(msg))
            await connect(msg, msg.guild.id);
        const path = 'sounds/' + soundName + '.mp3';
        const dispatcher = await voice_Connection.play(path);
        dispatcher.on('finish', () => {
            console.log('Finished playing!');
        });
    }
    else if (!Number.isNaN(soundName)) {
        let num = Number.parseInt(soundName);
        if (num >= 1 && num <= soundList.length) {
            if (!is_connected(msg))
                await connect(msg, msg.guild.id);
            const path = 'sounds/' + soundList[num - 1] + '.mp3';
            const dispatcher = await voice_Connection.play(path);
            dispatcher.on('finish', () => {
                console.log('Finished playing!');
            });
        }
    }
}
async function sounds(msg) {
    updateSoundList();
    let s = '';
    for (let i = 1; i <= soundList.length; i++) {
        s = s + i + '. ' + soundList[i - 1] + '\n';
    }
    await msg.channel.send(s);
}

let request = require(`request`);
function download(url,path,filename) {
    request.get(url)
        .on('error', console.error)
        .pipe(fs.createWriteStream(path + filename));
}

function upload(msg) {
    let attach = (msg.attachments);
    let arr = attach.array();
    if (attach.first()) {
        for (let i = 0; i < arr.length; ++i) {
            if (arr[i].name.slice(-4) === '.mp3') {
                download(attach.array()[i].url, 'sounds/', arr[i].name);
                add_sound_in_pseudoJSON(attach.array()[i].name.slice(0,-4));
            }
        }
        save_pseudoJSON();
    }
}

async function rename(msg) {
    updateSoundList();
    let strings = msg.content.trim().slice(8).split(' ');
    let str1 = strings[0];
    let str2 = strings[1];
    let path = 'sounds/';
    if (is_str_in_col(str1, soundList)) {
        fs.rename(path + str1 + '.mp3', path + str2 + '.mp3', function (err) {
            if (err)
                console.log(err);
        });
        let key = pseudoJSON.dictionary;
        for (let i = 0; i < key.length; ++i) {
            if (key[i].soundName === str1) {
                key[i].soundName = str2;
                key[i].pseudonyms[0] = str2;
                break;
            }
        }
        save_pseudoJSON();
    }
    else
        await msg.channel.send('Couldn\'t find a file with that name');
}

//Голосовые функции  
function voice_command_processing(txt, user) {
    let text = txt.replace(/[\s_'-]/g, '').toLowerCase();
    let dict = pseudoJSON.dictionary;
    for (let soundNum = 0; soundNum < dict.length; ++soundNum) {
        let ps = dict[soundNum].pseudonyms;
        for (let i = 0; i < ps.length; ++i) {
            if (text.indexOf(ps[i].replace(/[\s_'-]/g, '').toLowerCase()) != -1) {
                const path = 'sounds/' + dict[soundNum].soundName + '.mp3';
                const dispatcher = voice_Connection.play(path);
                dispatcher.on('finish', () => {
                    console.log('Finished playing!');
                });
            }
        }
    }
}

//work with JSON file
const pseudonyms_file = 'pseudonyms.json';
let pseudoJSON;
function load_pseudo() {
    if (fs.existsSync(pseudonyms_file)) {
        pseudoJSON = JSON.parse(fs.readFileSync(pseudonyms_file, 'utf8'));
    }
}
load_pseudo();
function save_pseudoJSON() {
    fs.writeFileSync(
        'pseudonyms.json',
        JSON.stringify(pseudoJSON)
    );
}
function add_pseudo(pseudo, sound) {
    for (key in pseudoJSON.dictionary) {
        if (key.soundName === sound) {
            key.pseudonyms.push(pseudo);
            break;
        }
    }
}
function add_sound_in_pseudoJSON(str) {
    let obj = {
        "soundName": str,
        "pseudonyms": [str]
    }
    pseudoJSON.dictionary.push(obj);
}
async function add_pseudo(msg) {
    updateSoundList();
    let strings = msg.content.trim().slice(11).split(' ');
    let isKeyEx = false;
    let key = pseudoJSON.dictionary;
    for (let num = 0; num < key.length; ++num) {
        if (key[num].soundName === strings[0]) {
            for (let i = 1; i < strings.length; ++i) {
                key[num].pseudonyms.push(strings[i]);
            }
            isKeyEx = true;
        }
        if (isKeyEx)
            break;
    }
    if (!isKeyEx)
        await msg.channel.send("Can't find this sound");
    save_pseudoJSON();
}
async function show_pseudo(msg) {
    let soundName = msg.content.trim().slice(12);
    let key = pseudoJSON.dictionary;
    let string = '';
    for (let num = 0; num < key.length; ++num) {
        if (key[num].soundName === soundName) {
            string += 'Pseudonyms for ' + soundName + ': ';
            for (let i = 0; i < key[num].pseudonyms.length; ++i) {
                string += key[num].pseudonyms[i] + ' ';
            }
            await msg.channel.send(string);
            return;
        }
    }
    await msg.channel.send("Can't find this sound");
}
async function delete_pseudo(msg) {
    let strings = msg.content.trim().slice(14).split(' ');
    let isKeyEx = false;
    let key = pseudoJSON.dictionary;
    for (let num = 0; num < key.length; ++num) {
        if (key[num].soundName === strings[0]) {
            for (let i = 1; i < strings.length; ++i) {
                for (let k = 0; k < key[num].pseudonyms.length; ++k) {
                    if (strings[i] === key[num].pseudonyms[k]) {
                        key[num].pseudonyms.splice(k, 1);
                        break;
                    }
                }
            }
            isKeyEx = true;
        }
        if (isKeyEx)
            break;
    }
    if (!isKeyEx)
        await msg.channel.send("Can't find this sound");
    save_pseudoJSON();
}
async function delete_sound(msg) {
    updateSoundList();
    let soundName = msg.content.trim().slice(13);
    if (is_str_in_col(soundName, soundList)) {
        //удаление файла
        const path = 'sounds/' + soundName + '.mp3';
        fs.unlink(path, err => {
            if (err) throw err; // не удалось удалить файл
            console.log('Файл успешно удалён');
        });
        //удаление из json
        let key = pseudoJSON.dictionary;
        for (let i = 0; i < key.length; ++i) {
            if (soundName === key[i].soundName) {
                key.splice(i, 1);
                break;
            }
        }
    }
    else
        await msg.channel.send("Can't find this sound");
    updateSoundList();
    save_pseudoJSON();
}
