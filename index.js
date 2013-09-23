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
  
  var irc = new (require('irc')).Client(details.server, details.nick, {
    channels: [details.channel]
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
    
    irc.on('message' + details.channel, function(from, message) {
      steam.sendMessage(details.chatroom, '<' + from + '> ' + message);
      
      var parts = message.match(/(\S+)\s+(.*\S)/);
      
      var triggers = {
        '.k': 'kick',
        '.kb': 'ban',
        '.unban': 'unban'
      };
      
      if (parts && parts[1] in triggers) {      
        irc.whois(from, function(info) {
          if (info.channels.indexOf('@' + details.channel) == -1)
            return; // not OP, go away
          
          Object.keys(steam.users).filter(function(steamID) {
            return steam.users[steamID].playerName == parts[2];
          }).forEach(function(steamID) {
            steam[triggers[parts[1]]](details.chatroom, steamID);
          });
        });
      } else if (message.trim() == '!lu' || message.trim() == '~lu') {
        response = "Current Users: " + Object.keys(steam.chatRooms[details.chatroom]).map(function(steamid){return steam.users[steamid].playerName;}).join(', ');
        irc.say(details.channel, response)
      }
    });
    
    irc.on('action', function(from, to, message) {
      if (to == details.channel) {
        steam.sendMessage(details.chatroom, from + ' ' + message);
      }
    });
    
    irc.on('+mode', function(channel, by, mode, argument, message) {
      if (channel == details.channel && mode == 'b') {
        steam.sendMessage(details.chatroom, by + ' sets ban on ' + argument);
      }
    });
    
    irc.on('-mode', function(channel, by, mode, argument, message) {
      if (channel == details.channel && mode == 'b') {
        steam.sendMessage(details.chatroom, by + ' removes ban on ' + argument);
      }
    });
    
    irc.on('kick' + details.channel, function(nick, by, reason, message) {
      steam.sendMessage(details.chatroom, by + ' has kicked ' + nick + ' from ' + details.channel + ' (' + reason + ')');
    });
    
    irc.on('join' + details.channel, function(nick) {
      steam.sendMessage(details.chatroom, nick + ' has joined ' + details.channel);
    });
    
    irc.on('part' + details.channel, function(nick) {
      steam.sendMessage(details.chatroom, nick + ' has left ' + details.channel);
    });
    
    irc.on('quit', function(nick, reason) {
      steam.sendMessage(details.chatroom, nick + ' has quit (' + reason + ')');
    });

    irc.on('nick', function(oldnick, newnick, channels, message) { 
      steam.sendMessage(details.chatroom, oldnick + " is now known as " + newnick); 
    });

    irc.on('error', function(err) {
      console.log('IRC error: ', err);
    });
  });
  
  steam.on('chatMsg', function(chatRoom, message, msgType, chatter) {
    var game = steam.users[chatter].gameName;
    var name = steam.users[chatter].playerName;
    if (msgType == Steam.EChatEntryType.ChatMsg) {
      irc.say(details.channel, require('util').format(game ? msgFormatGame : msgFormat, name, message));
    } else if (msgType == Steam.EChatEntryType.Emote) {
      irc.say(details.channel, require('util').format(game ? emoteFormatGame : emoteFormat, name, message));
    }
    
    var parts = message.split(/\s+/);
    var permissions = steam.chatRooms[chatRoom][chatter].permissions;
    
    if (parts[0] == '.k' && permissions & Steam.EChatPermission.Kick) {
      irc.send('KICK', details.channel, parts[1], 'requested by ' + name);
      
    } else if (parts[0] == '.kb' && permissions & Steam.EChatPermission.Ban) {
      irc.send('MODE', details.channel, '+b', parts[1]);
      irc.send('KICK', details.channel, parts[1], 'requested by ' + name);
      
    } else if (parts[0] == '.unban' && permissions & Steam.EChatPermission.Ban) {
      irc.send('MODE', details.channel, '-b', parts[1]);
      
    } else if (parts[0] == '!lu' || parts[0] == '~lu') {
      irc.send('NAMES', details.channel);
      irc.once('names' + details.channel, function(nicks) {
        steam.sendMessage(details.chatroom, 'Users in ' + details.channel + ': ' + Object.keys(nicks).map(function(key) {
          return nicks[key] + key;
        }).join(', '));
      });
    }
  });
  
  steam.on('chatStateChange', function(stateChange, chatterActedOn, chat, chatterActedBy) {
    var name = steam.users[chatterActedOn].playerName;
    switch (stateChange) {
      case Steam.EChatMemberStateChange.Entered:
        irc.say(details.channel, name + ' entered chat.');
        break;
      case Steam.EChatMemberStateChange.Left:
        irc.say(details.channel, name + ' left chat.');
        break;
      case Steam.EChatMemberStateChange.Disconnected:
        irc.say(details.channel, name + ' disconnected.');
        break;
      case Steam.EChatMemberStateChange.Kicked:
        irc.say(details.channel, name + ' was kicked by ' + steam.users[chatterActedBy].playerName + '.');
        break;
      case Steam.EChatMemberStateChange.Banned:
        irc.say(details.channel, name + ' was banned by ' + steam.users[chatterActedBy].playerName + '.');
    }
  });
  
  steam.on('user', function(user) {
    if (user.friendid in steam.users && steam.chatRooms[details.chatroom] != undefined)
      if (user.friendid in steam.chatRooms[details.chatroom])
        if (steam.users[user.friendid].playerName != user.playerName && steam.users[user.friendid].playerName != '' && user.playerName != '')
          irc.say(details.channel, steam.users[user.friendid].playerName + ' is now known as ' + user.playerName);
  });
  
  steam.on('loggedOff', function(result) {
    console.log("Logged off:", result);
    console.log("Removing Event Listeners");
    irc.removeAllListeners('message' + details.channel);
    irc.removeAllListeners('action');
    irc.removeAllListeners('+mode');
    irc.removeAllListeners('-mode');
    irc.removeAllListeners('kick' + details.channel);
    irc.removeAllListeners('join' + details.channel);
    irc.removeAllListeners('part' + details.channel);
    irc.removeAllListeners('quit');
    irc.removeAllListeners('nick');
    irc.removeAllListeners('error');
  });
  
  steam.on('sentry', function(data) {
    require('fs').writeFileSync('sentry', data)
;  })
  
  steam.on('debug', console.log);
};
