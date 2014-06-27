var Steam = require('steam');
var fs = require('fs');

// if we've saved a server list, use it
if (fs.existsSync('servers')) {
  Steam.servers = JSON.parse(fs.readFileSync('servers'));
}


//maybe add nick reg? Might help.
module.exports = function(details) {
  var msgFormat = details.msgFormat || '\u000302%s\u000f: %s';
  var emoteFormat = details.emoteFormat || '\u000302%s %s';
  var msgFormatGame = details.msgFormatGame || details.msgFormat || '\u000303%s\u000f: %s';
  var emoteFormatGame = details.emoteFormatGame || details.emoteFormat || '\u000303%s %s'; 
  
  var queue = [];

  var botsJoined = false;

  function sendMessage(msg) {
    if (steam.loggedOn) {
      regex="[\\x02\\x1F\\x0F\\x16]|\\x03(\\d\\d?(,\\d\\d?)?)?";
      message = msg.replace(new RegExp(regex, 'g'), "");
      steam.sendMessage(details.chatroom, message);
    } else {
      queue.push(msg);
    }
  }

  function getKeyByValue(dict, value ) {
    for( var prop in dict ) {
        if( dict.hasOwnProperty( prop ) ) {
             if( dict[ prop ] === value )
                 return prop;
        }
    }
  }

  function createValidNick(originalNick) {
    newNick = "";
    for (character in originalNick) {
      if (newNick.length == 0) {
        if ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-\\{}[]^`| ".indexOf(originalNick[character]) != -1)
          newNick += originalNick[character]
      }
      else {
        if ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-\\{}[]^`| ".indexOf(originalNick[character]) != -1)
          newNick += originalNick[character]
      }
    }
    newNick = newNick.replace(/ /g, "_")
    if (newNick.length > 0)
      return newNick.slice(0,17);
    else
      return "SteamUser";
  }
  
  var steamIRCBots = {};

  //this will not persist, but it is a convenience if needed.
  var bannedChatters = {};

  //Technically, this still isn't threadsafe in any way, but it seems to work better than any other method.
  function joinSteamBots()
  {
    if (!botsJoined) {
      if (steam.chatRooms[details.chatroom] != undefined)
      {
        console.log("joining bots")
        for (user in steam.chatRooms[details.chatroom]) {
          if(user != steam.steamID)
            joinUser(user);
        }
        botsJoined = true;
      }
      else
      {
        console.log("Not connected to chat, waiting 100ms")
        setTimeout(joinSteamBots, 100);
      }
    }
  }

  function joinUser(user) {
    steamIRCBots[user] = new (require('irc')).Client(details.server, createValidNick(steam.users[user].playerName) + details.suffix, {
                                      userName: "SteamBot", realName: 'http://steamcommunity.com/profiles/' + user + ' ' + steam.users[user].playerName,
                                      webIrc: true, webIrcHost: user, webIrcPassword: details.webircpassword, webIrcUser: "Steambot", webIrcIp: "127.0.0.1"
                                    });
    steamIRCBots[user].once('registered', function(message) {this.send("MODE", this.nick, "-x"); this.join(details.channel) });
    steamIRCBots[user].on('error', function(err) {
        console.log('IRC error: ', err);
      });
  
  }

  function normalizeNick(steamNick) {
    return (createValidNick(steamNick) + details.suffix).toLowerCase();
  }

  function sendIRCMessage(user, msg) {
    if (Object.keys(steamIRCBots).indexOf(user) != -1) {
      steamIRCBots[user].say(details.channel, msg);
    }
    else {
      irc.say(details.channel, '<' + steam.users[user].playerName + '> ' + msg);
    }
  }

  function steamUserInBots(user) {
    return Object.keys(steamIRCBots).map(function(key) { return (this[key].nick).toLowerCase();}, steamIRCBots).indexOf(user.toLowerCase()) != -1;
  }

  function getSteamUserByNick(nick) {
    return Object.keys(steamIRCBots)[Object.keys(steamIRCBots).map(function(key) { return (this[key].nick).toLowerCase();}, steamIRCBots).indexOf(nick.toLowerCase())];
  }

  var irc = new (require('irc')).Client(details.server, details.nick, {
    channels: [details.channel], userName: "SteamBot"
  });
  
  irc.on('error', function(err) {
    console.log('IRC error: ', err);
  });
  
  irc.on('message' + details.channel, function(from, message) {
    if (!steamUserInBots(from))
      sendMessage('<' + from + '> ' + message);
  });
  
  irc.on('action', function(from, to, message) {
    if (to == details.channel && !steamUserInBots(from)) {
      sendMessage(from + ' ' + message);
    }
  });
  
  irc.on('+mode', function(channel, by, mode, argument, message) {
    if (channel == details.channel && mode == 'b') {
      sendMessage(by + ' sets ban on ' + argument);
      mask = argument.match(/(.+)!(.+)@(.+)/);
      if (steamUserInBots(mask[1])) {
        console.log('Banning ' + mask[1].toLowerCase() + ' (' + getSteamUserByNick(mask[1]) + ') from chatroom');
        steam.ban(details.chatroom, getSteamUserByNick(mask[1]));
      }
      else if (Object.keys(steam.users).indexOf(mask[3]) != -1) {
        console.log('Banning ' + steamIRCBots[mask[3]].nick + ' (' + mask[3] + ') from chatroom');
        steam.ban(details.chatroom, mask[3]);
      }
    }
  });
  
  irc.on('-mode', function(channel, by, mode, argument, message) {
    if (channel == details.channel && mode == 'b') {
      sendMessage(by + ' removes ban on ' + argument);
      mask = argument.match(/(.+)!(.+)@(.+)/);
      if (Object.keys(bannedChatters).indexOf(mask[1].toLowerCase()) != -1) {
        console.log('Unbanning ' + mask[1].toLowerCase() + ' (' + bannedChatters[mask[1].toLowerCase()] + ') from chatroom');
        steam.unban(details.chatroom, bannedChatters[mask[1].toLowerCase()]);
        delete bannedChatters[mask[1].toLowerCase()];
      }
      else if (Object.keys(steam.users).indexOf(mask[3]) != -1) {
        key = getKeyByValue(bannedChatters, mask[3]);
        console.log('Unbanning ' + key + ' (' + mask[3] + ') from chatroom');
        steam.unban(details.chatroom, mask[3]);
        delete bannedChatters[key];
      }
    }
  });
  
  irc.on('kick' + details.channel, function(nick, by, reason, message) {
    sendMessage(by + ' has kicked ' + nick + ' from ' + details.channel + ' (' + reason + ')');
    if (steamUserInBots(nick)) {
      console.log('Kicking ' + nick + ' (' + getSteamUserByNick(nick) + ') from chatroom');
      steam.kick(details.chatroom, getSteamUserByNick(nick));
    }
  });
  
  irc.on('join' + details.channel, function(nick) {
    if (!steamUserInBots(nick))
      sendMessage(nick + ' has joined ' + details.channel);
  });
  
  irc.on('part' + details.channel, function(nick) {
    if (!steamUserInBots(nick))
      sendMessage(nick + ' has left ' + details.channel);
  });
  
  irc.on('quit', function(nick, reason) {
    if (!steamUserInBots(nick))
      sendMessage(nick + ' has quit (' + reason + ')');
    else 
      delete steamIRCBots[getSteamUserByNick(nick)];
  });

  irc.on('nick', function(oldnick, newnick, channels, message) { 
    if (!steamUserInBots(oldnick))
      steam.sendMessage(details.chatroom, oldnick + " is now known as " + newnick); 
  });
  
  irc.on('topic', function(channel, topic, nick, mesage) {
    sendMessage("The topic is now: " + topic);
  });

  var steam = new Steam.SteamClient();
  steam.logOn({
    accountName: details.username,
    password: details.password,
    authCode: details.authCode,
    shaSentryfile: require('fs').existsSync('sentry') ? require('fs').readFileSync('sentry') : undefined
  });
  
  steam.on('servers', function(servers) {
    fs.writeFile('servers', JSON.stringify(servers));
  });
  
  steam.on('loggedOn', function(result) {
    console.log('Logged on!');
    
    steam.setPersonaState(Steam.EPersonaState.Online);
    steam.joinChat(details.chatroom);
    
    queue.forEach(sendMessage);
    queue = [];
    setTimeout(joinSteamBots, 100);
  });
  
  steam.on('chatMsg', function(chatRoom, message, msgType, chatter) {
    var parts = message.split(/\s+/);
    
    if (parts[0] == '!lu' || parts[0] == '~lu') {
      irc.send('NAMES', details.channel);
      irc.once('names' + details.channel, function(nicks) {
        steam.sendMessage(details.chatroom, 'Users in ' + details.channel + ': ' + Object.keys(nicks).map(function(key) {
          return nicks[key] + key;
        }).join(', '));
      });
    } else if (parts[0] == '!topic' || parts[0] == '~topic') {
      var channel = irc.chanData(details.channel);
      if ( channel ) {
        sendMessage(channel.topic)
      }
    } else if (parts[0] == '/me') {
      if (Object.keys(steamIRCBots).indexOf(chatter) != -1) {
        steamIRCBots[chatter].action(details.channel, message.slice(4));
      }
      else {
        irc.say(details.channel, steam.users[chatter].playerName + ' ' + message.slice(4));
      }
    } else {
      sendIRCMessage(chatter, message)
    }
  });
  
  steam.on('chatStateChange', function(stateChange, chatterActedOn, chat, chatterActedBy) {
    var name = steam.users[chatterActedOn].playerName;
    switch (stateChange) {
      case Steam.EChatMemberStateChange.Entered:
        joinUser(chatterActedOn);
        break;
      case Steam.EChatMemberStateChange.Left:
        if (Object.keys(steamIRCBots).indexOf(chatterActedOn) != -1) {
          steamIRCBots[chatterActedOn].disconnect("Left chat.");
        }
        break;
      case Steam.EChatMemberStateChange.Disconnected:
        if (Object.keys(steamIRCBots).indexOf(chatterActedOn) != -1) {
          steamIRCBots[chatterActedOn].disconnect("Disconnected from chat.");
        }
        break;
      case Steam.EChatMemberStateChange.Kicked:
        if (Object.keys(steamIRCBots).indexOf(chatterActedOn) != -1) {
          steamIRCBots[chatterActedOn].disconnect('Kicked by ' + steam.users[chatterActedBy].playerName + '.');
        }
        break;
      case Steam.EChatMemberStateChange.Banned:
        if (Object.keys(steamIRCBots).indexOf(chatterActedOn) != -1) {
          steamIRCBots[chatterActedOn].disconnect('Banned by ' + steam.users[chatterActedBy].playerName + '.');
          bannedChatters[steamIRCBots[chatterActedOn].nick] = chatterActedOn;
        }
    }
  });

  steam.on('user', function(user) {
    if (user.friendid in steam.users && steam.chatRooms[details.chatroom] != undefined)
      if (user.friendid in steam.chatRooms[details.chatroom])
        if (steam.users[user.friendid].playerName != user.playerName && steam.users[user.friendid].playerName != '' && user.playerName != '')
        {
          steamIRCBots[user.friendid].send("NICK", createValidNick(user.playerName) + details.suffix);
        }
  });
  
  steam.on('loggedOff', function(result) {
    console.log("Logged off:", result);
    for (user in steamIRCBots) {
      steamIRCBots[user].disconnect("Steam seems down");
      delete steamIRCBots[user];
    }
    botsJoined = false;
  });
  
  steam.on('sentry', function(data) {
    require('fs').writeFileSync('sentry', data);
  });
  
  steam.on('debug', console.log);

  steam.on('error', function(err) {
    if (err.cause == 'logonFail')
    {
      setTimeout(function() {steam.logOn({
        accountName: details.username,
        password: details.password,
        authCode: details.authCode,
        shaSentryfile: require('fs').existsSync('sentry') ? require('fs').readFileSync('sentry') : undefined
      });}, 10000 );
      console.log("Logon failed, waiting 10 seconds and retrying.")
      queue=[];
    }
  });
};
