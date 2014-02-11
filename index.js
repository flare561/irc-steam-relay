var Steam = require('steam');
var fs = require('fs');

// if we've saved a server list, use it
if (fs.existsSync('servers')) {
  Steam.servers = JSON.parse(fs.readFileSync('servers'));
}

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

  function createValidNick(originalNick) {
    regex="[^a-zA-Z_\\-\\\\[\\]{}\\^`|][^a-zA-Z0-9_\\-\\\\[\\]{}\\^`|]?";
    newNick = originalNick.replace(/ /g, "_").replace(new RegExp(regex, 'g'), "");
    if (newNick.length > 0)
      return newNick.slice(0,17);
    else
      return "User";
  }
  
  var steamIRCBots = {};


  //Technically, this still isn't threadsafe in any way, but it seems to work better than any other method.
  function joinSteamBots()
  {
    if (!botsJoined) {
      if (steam.chatRooms[details.chatroom] != undefined)
      {
        console.log("joining bots")
        for (user in steam.chatRooms[details.chatroom]) {
          if(user != '76561198093596874')
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
    steamIRCBots[user] = new (require('irc')).Client(details.server, createValidNick(steam.users[user].playerName) + "_s", {
                                      channels: [details.channel], userName: "SteamBot", realName: steam.users[user].playerName
                                    });
    steamIRCBots[user].on('error', function(err) {
        console.log('IRC error: ', err);
      });
  
  }

  function sendIRCMessage(user, msg) {
    if (Object.keys(steamIRCBots).indexOf(user) != -1) {
      steamIRCBots[user].say(details.channel, msg);
    }
    else {
      irc.say(details.channel, '<' + steam.users[user].playerName + '> ' + msg);
    }
  }

  var irc = new (require('irc')).Client(details.server, details.nick, {
    channels: [details.channel], userName: "SteamBot"
  });
  
  irc.on('error', function(err) {
    console.log('IRC error: ', err);
  });
  
  irc.on('message' + details.channel, function(from, message) {
    if (from.slice(-2) != '_s')
      sendMessage('<' + from + '> ' + message);
  });
  
  irc.on('action', function(from, to, message) {
    if (to == details.channel && from.slice(-2) != '_s') {
      sendMessage(from + ' ' + message);
    }
  });
  
  irc.on('+mode', function(channel, by, mode, argument, message) {
    if (channel == details.channel && mode == 'b') {
      sendMessage(by + ' sets ban on ' + argument);
    }
  });
  
  irc.on('-mode', function(channel, by, mode, argument, message) {
    if (channel == details.channel && mode == 'b') {
      sendMessage(by + ' removes ban on ' + argument);
    }
  });
  
  irc.on('kick' + details.channel, function(nick, by, reason, message) {
    sendMessage(by + ' has kicked ' + nick + ' from ' + details.channel + ' (' + reason + ')');
  });
  
  irc.on('join' + details.channel, function(nick) {
    if (nick.slice(-2) != '_s')
      sendMessage(nick + ' has joined ' + details.channel);
  });
  
  irc.on('part' + details.channel, function(nick) {
    if (nick.slice(-2) != '_s')
      sendMessage(nick + ' has left ' + details.channel);
  });
  
  irc.on('quit', function(nick, reason) {
    if (nick.slice(-2) != '_s')
      sendMessage(nick + ' has quit (' + reason + ')');
  });

  irc.on('nick', function(oldnick, newnick, channels, message) { 
    if (oldnick.slice(-2) != '_s')
      steam.sendMessage(details.chatroom, oldnick + " is now known as " + newnick); 
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
    var permissions = steam.chatRooms[chatRoom][chatter].permissions;
    
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
          delete steamIRCBots[chatterActedOn];
        }
        break;
      case Steam.EChatMemberStateChange.Disconnected:
        if (Object.keys(steamIRCBots).indexOf(chatterActedOn) != -1) {
          steamIRCBots[chatterActedOn].disconnect("Disconnected from chat.");
          delete steamIRCBots[chatterActedOn];
        }
        break;
      case Steam.EChatMemberStateChange.Kicked:
        if (Object.keys(steamIRCBots).indexOf(chatterActedOn) != -1) {
          steamIRCBots[chatterActedOn].disconnect('Kicked by ' + steam.users[chatterActedBy].playerName + '.');
          delete steamIRCBots[chatterActedOn];
        }
        break;
      case Steam.EChatMemberStateChange.Banned:
        if (Object.keys(steamIRCBots).indexOf(chatterActedOn) != -1) {
          steamIRCBots[chatterActedOn].disconnect('Banned by ' + steam.users[chatterActedBy].playerName + '.');
          delete steamIRCBots[chatterActedOn];
        }
    }
  });

  steam.on('user', function(user) {
    if (user.friendid in steam.users && steam.chatRooms[details.chatroom] != undefined)
      if (user.friendid in steam.chatRooms[details.chatroom])
        if (steam.users[user.friendid].playerName != user.playerName && steam.users[user.friendid].playerName != '' && user.playerName != '')
        {
          steamIRCBots[user.friendid].send("NICK", createValidNick(user.playerName) + "_s");
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
  })
  
  steam.on('debug', console.log);
};
