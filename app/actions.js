import { homedir } from 'os'
import { decode, encode } from 'dat-encoding'
import { ipcRenderer } from 'electron'
import Cabal from 'cabal-core'
import collect from 'collect-stream'
import crypto from 'hypercore-crypto'
import del from 'del'
import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import Swarm from 'cabal-core/swarm'
import commander from './commander'
const { dialog } = require('electron').remote

const DEFAULT_CHANNEL = 'default'
const HOME_DIR = homedir()
const DATA_DIR = path.join(HOME_DIR, '.cabal-desktop', `v${Cabal.databaseVersion}`)
const TEMP_DIR = path.join(DATA_DIR, '.tmp')
const STATE_FILE = path.join(DATA_DIR, 'cabals.json')
const DEFAULT_USERNAME = 'conspirator'
const MAX_FEEDS = 1000
const NOOP = function () { }

const cabals = {}
let currentCabalKey

export const viewCabal = ({ addr, channel }) => dispatch => {
  const cabal = cabals[addr]
  if (cabal) {
    currentCabalKey = addr
    if (channel) {
      cabal.client.channel = channel
      dispatch(viewChannel({ addr, channel }))
    }
    dispatch({
      addr,
      channel: cabal.client.channel,
      type: 'VIEW_CABAL'
    })
    storeOnDisk()
  }
}

export const showCabalSettings = ({ addr }) => dispatch => {
  dispatch({ type: 'SHOW_CABAL_SETTINGS', addr })
}

export const hideCabalSettings = () => dispatch => {
  dispatch({ type: 'HIDE_CABAL_SETTINGS' })
}

export const saveCabalSettings = ({ addr, settings }) => dispatch => {
  dispatch(updateCabal({ addr, settings }))
}

export const removeCabal = ({ addr }) => dispatch => {
  dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Remove'],
    message: `Are you sure you want to remove this cabal (${addr.substr(0, 8)}...) from Cabal Desktop?`
  }, (response) => {
    if (response) {
      dispatch(confirmRemoveCabal({ addr }))
    }
  })
}

export const confirmRemoveCabal = ({ addr }) => dispatch => {
  const cabal = cabals[addr]
  if (cabal.client && cabal.client.swarm) {
    for (const con of cabal.client.swarm.connections) {
      con.removeAllListeners()
    }
  }
  delete cabals[addr]
  storeOnDisk()
  dispatch({ type: 'DELETE_CABAL', addr })

  var cabalKeys = Object.keys(cabals)
  if (cabalKeys.length) {
    dispatch({
      addr: cabalKeys[0],
      channel: cabals[cabalKeys[0]].client.channel,
      type: 'VIEW_CABAL'
    })
  } else {
    dispatch({ type: 'CHANGE_SCREEN', screen: 'addCabal' })
  }
}

export const onCommand = ({ addr, message }) => dispatch => {
  dispatch(commander(cabals[addr], message))
}

export const listCommands = () => dispatch => {
  return dispatch(commander())
}

export const updateCabal = (opts) => dispatch => {
  Object.assign(cabals[opts.addr], opts)
  storeOnDisk()
  dispatch({ type: 'UPDATE_CABAL', ...opts })
}

export const joinChannel = ({ addr, channel }) => dispatch => {
  if (channel.length > 0) {
    dispatch(addChannel({ addr, channel }))
    dispatch(viewChannel({ addr, channel }))
  }
}

export const leaveChannel = ({ addr, channel }) => dispatch => {
  if (channel.length > 0) {
    // TODO
    // var currentCabal = cabals[addr]
    // currentCabal.leaveChannel(channel)
    // dispatch({type: 'UPDATE_CABAL', addr, channels: currentCabal.channels})
  }
}

export const viewNextChannel = ({ addr }) => dispatch => {
  let cabal = cabals[addr]
  let currentChannel = cabal.client.channel
  let channels = cabal.client.channels
  if (channels.length) {
    let index = channels.findIndex((channel) => channel === currentChannel) + 1
    if (index > channels.length - 1) {
      index = 0
    }
    dispatch(viewChannel({ addr, channel: channels[index] }))
  }
}

export const viewPreviousChannel = ({ addr }) => dispatch => {
  let cabal = cabals[addr]
  let currentChannel = cabal.client.channel
  let channels = cabal.client.channels
  if (channels.length) {
    let index = channels.findIndex((channel) => channel === currentChannel) - 1
    if (index < 0) {
      index = channels.length - 1
    }
    dispatch(viewChannel({ addr, channel: channels[index] }))
  }
}

export const changeUsername = ({ addr, username }) => dispatch => {
  const currentCabal = cabals[addr]
  currentCabal.username = username
  currentCabal.publishNick(username)
  dispatch({ type: 'UPDATE_CABAL', addr, username })
  dispatch(addLocalSystemMessage({
    addr,
    content: `Nick set to: ${username}`
  }))
}

export const getMessages = ({ addr, channel, count }) => dispatch => {
  if (channel.length === 0) return
  const cabal = cabals[addr]
  const rs = cabal.messages.read(channel, { limit: count, lt: '~' })
  collect(rs, (err, msgs) => {
    if (err) return
    msgs.reverse()
    cabal.client.channelMessages[channel] = []
    msgs.forEach((msg) => {
      const author = cabal.client.users[msg.key] ? cabal.client.users[msg.key].name : DEFAULT_USERNAME
      const { type, timestamp, content } = msg.value
      cabal.client.channelMessages[channel].push({
        author,
        content: content.text,
        key: msg.key + timestamp,
        time: timestamp,
        type
      })
    })

    let channelTopic = ''
    cabal.topics.get(channel, (err, topic) => {
      if (err) return
      if (topic) {
        channelTopic = topic
        dispatch({ type: 'UPDATE_TOPIC', addr, topic: channelTopic })
      }
    })

    dispatch({ type: 'UPDATE_CABAL', addr, messages: cabal.client.channelMessages[channel] })
  })
}

export const viewChannel = ({ addr, channel }) => dispatch => {
  if (channel.length === 0) return
  const cabal = cabals[addr]
  cabal.client.channel = channel
  cabal.client.channelMessagesUnread[channel] = 0
  storeOnDisk()

  // dont pass around swarm and watcher, only the things that matter.
  dispatch({
    addr,
    allChannelsUnreadCount: cabal.client.allChannelsUnreadCount,
    channel: cabal.client.channel,
    channelMessagesUnread: cabal.client.channelMessagesUnread,
    channels: cabal.client.channels,
    messages: cabal.client.channelMessages[channel],
    settings: cabal.settings,
    type: 'ADD_CABAL',
    username: cabal.username,
    users: cabal.client.users
  })
  dispatch({
    type: 'VIEW_CABAL',
    addr,
    channel: cabal.client.channel
  })
  dispatch(getMessages({ addr, channel, count: 100 }))
  dispatch(updateChannelMessagesUnread({ addr, channel, unreadCount: 0 }))
}

export const changeScreen = ({ screen, addr }) => ({ type: 'CHANGE_SCREEN', screen, addr })

export const addCabal = ({ addr, input, username, settings }) => dispatch => {
  if (!addr) {
    try {
      const key = decode(input)
      addr = encode(key)
    } catch (err) {
    }
  }
  if (cabals[addr]) {
    // Show cabal if already added to client
    dispatch(viewCabal({ addr }))
    if (username) {
      dispatch(changeUsername({ addr, username }))
    }
    return
  }
  if (!settings) {
    // Default per cabal user settings
    settings = {
      enableNotifications: false,
      alias: ''
    }
  }
  if (!addr) {
    // Create new Cabal
    addr = crypto.keyPair().publicKey.toString('hex')
  }
  initializeCabal({ addr, username, dispatch, settings })
}

export const addChannel = ({ addr, channel }) => dispatch => {
  const cabal = cabals[addr]
  const onMessage = (message) => {
    const { type, timestamp, content } = message.value
    const channel = content.channel
    if (cabal.client.users[message.key]) {
      const author = cabal.client.users[message.key] ? cabal.client.users[message.key].name : DEFAULT_USERNAME
      if (!cabal.client.channelMessages[channel]) {
        cabal.client.channelMessages[channel] = []
      }
      cabal.client.channelMessages[channel].push({
        author,
        content: content.text,
        key: message.key + timestamp,
        time: timestamp,
        type
      })
      if (!!cabal.settings.enableNotifications && !document.hasFocus()) {
        window.Notification.requestPermission()
        let notification = new window.Notification(author, {
          body: content.text
        })
        notification.onclick = () => {
          dispatch(viewCabal({ addr, channel }))
        }
      }
    }
    if (cabal.client.channel === channel) {
      dispatch({ type: 'UPDATE_CABAL', addr, messages: cabal.client.channelMessages[channel] })
    }
    const isCurrentCabalAndChannel = (cabal.client.channel === channel) && (cabal.key === currentCabalKey)
    if (!isCurrentCabalAndChannel) {
      dispatch(updateChannelMessagesUnread({ addr, channel }))
    }
  }
  if (!cabal.client.channels.includes(channel)) {
    cabal.client.channels.push(channel)
    if (!cabal.client.channelListeners[channel]) {
      cabal.messages.events.on(channel, onMessage)
      cabal.client.channelListeners[channel] = onMessage
    }
  }
}

export const addMessage = ({ message, addr }) => dispatch => {
  cabals[addr].publish(message)
}

export const addLocalSystemMessage = ({ addr, channel, content }) => dispatch => {
  var cabal = cabals[addr]
  channel = channel || cabal.client.channel
  cabal.client.channelMessages[cabal.client.channel].push({
    content,
    type: 'local/system'
  })
  dispatch(updateCabal({ addr, messages: cabal.client.channelMessages[cabal.client.channel] }))
}

export const setChannelTopic = ({ topic, channel, addr }) => dispatch => {
  cabals[addr].publishChannelTopic(channel, topic)
  dispatch(addLocalSystemMessage({
    addr,
    content: `Topic set to: ${topic}`
  }))
  dispatch({ type: 'UPDATE_TOPIC', addr, topic })
}

export const updateChannelMessagesUnread = ({ addr, channel, unreadCount }) => dispatch => {
  const cabal = cabals[addr]
  if (unreadCount !== undefined) {
    cabal.client.channelMessagesUnread[channel] = unreadCount
  } else {
    if (!cabal.client.channelMessagesUnread[channel]) {
      cabal.client.channelMessagesUnread[channel] = 1
    } else {
      cabal.client.channelMessagesUnread[channel] = cabal.client.channelMessagesUnread[channel] + 1
    }
  }
  let allChannelsUnreadCount = Object.values(cabal.client.channelMessagesUnread).reduce((total, value) => {
    return total + (value || 0)
  }, 0)
  cabal.client.allChannelsUnreadCount = allChannelsUnreadCount
  dispatch({ type: 'UPDATE_CABAL', addr, channelMessagesUnread: cabal.client.channelMessagesUnread, allChannelsUnreadCount })
  dispatch(updateAppIconBadge())
}

export const updateAppIconBadge = (badgeCount) => dispatch => {
  // TODO: if (!!app.settings.enableBadgeCount) {
  badgeCount = badgeCount || Object.values(cabals).reduce((total, cabal) => {
    return total + (cabal.client.allChannelsUnreadCount || 0)
  }, 0)
  ipcRenderer.send('update-badge', { badgeCount, showCount: false }) // TODO: app.settings.showBadgeCountNumber
  dispatch({ type: 'UPDATE_WINDOW_BADGE', badgeCount })
}

export const showEmojiPicker = () => dispatch => {
  dispatch({ type: 'SHOW_EMOJI_PICKER' })
}

export const hideEmojiPicker = () => dispatch => {
  dispatch({ type: 'HIDE_EMOJI_PICKER' })
}

const initializeCabal = ({ addr, username, dispatch, settings }) => {
  username = username || DEFAULT_USERNAME
  const dir = path.join(DATA_DIR, addr)
  const cabal = Cabal(dir, addr, { maxFeeds: MAX_FEEDS, username })

  currentCabalKey = addr

  // Add an object to place client data onto the
  // Cabal instance to keep the client somewhat organized
  // and distinct from the class funcationality.
  cabal.client = {}

  // Add an object to store Desktop's per cabal client settings
  cabal.settings = settings || {}

  cabal.ready(function (err) {
    if (err) return console.error(err)
    cabal.key = addr
    const swarm = Swarm(cabal)

    cabal.username = username
    cabal.client.swarm = swarm
    cabal.client.addr = addr
    cabal.client.channel = DEFAULT_CHANNEL
    cabal.client.channels = []
    cabal.client.user = { name: username }
    cabal.client.users = {}
    cabal.client.channelMessages = {}
    cabal.client.channelMessagesUnread = {}
    cabal.client.channelListeners = {}

    cabal.channels.events.on('add', (channel) => {
      dispatch(addChannel({ addr, channel }))
    })
    cabal.channels.get((err, channels) => {
      if (err) return console.error(err)
      if (channels.length === 0) {
        channels.push(DEFAULT_CHANNEL)
      }
      channels.forEach((channel) => {
        dispatch(addChannel({ addr, channel }))
      })
    })

    cabal.users.getAll((err, users) => {
      if (err) return
      cabal.client.users = users
      const updateLocalKey = () => {
        cabal.getLocalKey((err, lkey) => {
          if (err) return
          if (!Object.keys(cabal.client.users).includes(lkey)) {
            cabal.client.users[lkey] = {
              local: true,
              online: true,
              key: lkey,
              name: cabal.client.user.name || DEFAULT_USERNAME
            }
          }
          Object.keys(cabal.client.users).forEach((key) => {
            if (key === lkey) {
              cabal.client.user = cabal.client.users[key]
              cabal.client.user.local = true
              cabal.client.user.online = true
              cabal.client.user.key = key
              cabal.username = cabal.client.user.name
              cabal.publishNick(cabal.username)
            }
          })
          dispatch({ type: 'UPDATE_CABAL', addr, users: cabal.client.users, username: cabal.username })
          dispatch(joinChannel({ addr, channel: DEFAULT_CHANNEL }))
        })
      }
      updateLocalKey()

      cabal.users.events.on('update', (key) => {
        // TODO: rate-limit
        cabal.users.get(key, (err, user) => {
          if (err) return
          cabal.client.users[key] = Object.assign(cabal.client.users[key] || {}, user)
          cabal.client.users[key].name = cabal.client.users[key].name || DEFAULT_USERNAME
          if (cabal.client.user && key === cabal.client.user.key) cabal.client.user = cabal.client.users[key]
          if (!cabal.client.user) updateLocalKey()
          dispatch({ type: 'UPDATE_CABAL', addr, users: cabal.client.users })
        })
      })
      cabal.on('peer-added', (key) => {
        let found = false
        Object.keys(cabal.client.users).forEach((k) => {
          if (k === key) {
            cabal.client.users[k].online = true
            found = true
          }
        })
        if (!found) {
          cabal.client.users[key] = {
            key: key,
            online: true
          }
        }
        dispatch({ type: 'UPDATE_CABAL', addr, users: cabal.client.users })
      })
      cabal.on('peer-dropped', (key) => {
        Object.keys(cabal.client.users).forEach((k) => {
          if (k === key) {
            cabal.client.users[k].online = false
            dispatch({ type: 'UPDATE_CABAL', addr, users: cabal.client.users })
          }
        })
      })
    })
  })
  cabals[addr] = cabal
}

async function lskeys () {
  let list
  try {
    list = filterForKeys(fs.readdirSync(DATA_DIR))
  } catch (_) {
    list = []
    await mkdirp(DATA_DIR)
  }
  return list
}

function encodeStateForKey (key) {
  const username = (cabals[key] && cabals[key].username) || DEFAULT_USERNAME
  const settings = (cabals[key] && cabals[key].settings) || {}
  return JSON.stringify({ username, addr: key, settings })
}

async function readstate () {
  let state
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (_) {
    state = {}
  }
  return state
}

function iterateCabals (state, fn) {
  const statekeys = Object.keys(state)
  for (const key of statekeys) {
    fn(JSON.parse(state[key]))
  }
  return statekeys.length
}

// TODO: consolidate closure pattern
let _dispatch = NOOP
function _dispatch_add_cabal (opts) {
  _dispatch(addCabal(opts))
}

export const loadFromDisk = () => async dispatch => {
  const state = await readstate()
  _dispatch = dispatch
  const cabalsLength = iterateCabals(state, _dispatch_add_cabal)
  dispatch({ type: 'CHANGE_SCREEN', screen: cabalsLength ? 'main' : 'addCabal' })
  _dispatch = NOOP
}

const storeOnDisk = async () => {
  const cabalsState = Object.keys(cabals).reduce(
    (acc, addr) => {
      // if (cabals[addr].client.addr !== addr) debugger
      return ({
        ...acc,
        [addr]: encodeStateForKey(addr)
      })
    },
    {}
  )
  fs.writeFileSync(STATE_FILE, JSON.stringify(cabalsState, null, 2))
}

// removes non-key items via unordered insertion & length clamping
// monomorphic, zero closure & arr allocs
// hoisting var declarations to respect v8 deopt edgecases with let & unary ops
function filterForKeys (arr) {
  var l = arr.length
  var last = --l
  while (l > -1) {
    const charcount = arr[l].length
    if (charcount !== 64) {
      if (l !== last) {
        arr[l] = arr[last]
      }
      arr.length = last
      last--
    }
    l--
  }
  return arr
}
