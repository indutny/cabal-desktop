import React from 'react'
import moment from 'moment'
import remark from 'remark'
import remarkEmoji from 'remark-emoji'
import remarkReact from 'remark-react'

import Avatar from './avatar'

export default function MessagesContainer (props) {
  const enrichText = (content) => {
    return remark().use(remarkReact).use(remarkEmoji).processSync(content).contents
  }
  const renderDate = (time) => {
    const t = moment(time)
    return (
      <span>
        {t.format('h:mm A')}
        <span className='messages__item__metadata__date'>{t.format('LL')}</span>
      </span>
    )
  }
  const messages = props.cabal.messages
  if (messages.length === 0) {
    return (
      <div className='messages starterMessage'>
        This is a new channel. Send a message to start things off!
      </div>
    )
  } else {
    let lastAuthor = null
    return (
      <div className='messages'>
        {messages.map((message, index) => {
          const repeatedAuthor = message.author === lastAuthor
          const me = message.author === props.cabal.username
          lastAuthor = message.author
          if (message.type === 'local/system') {
            var defaultSystemName = 'Cabalbot'
            return (
              <div key={index} className='messages__item messages__item--system'>
                <div className='messages__item__avatar'>
                  <div className='messages__item__avatar__img'>
                    <Avatar name={message.author || defaultSystemName} />
                  </div>
                </div>
                <div className='messages__item__metadata'>
                  <div className='messages__item__metadata__name'>{message.author || defaultSystemName}{renderDate(message.time)}</div>
                  <div className='text'>{enrichText(message.content)}</div>
                </div>
              </div>
            )
          }
          if (message.type === 'chat/text') {
            return (
              <div key={index} className='messages__item'>
                <div className='messages__item__avatar'>
                  {repeatedAuthor ? null : <Avatar name={message.author || 'conspirator'} />}
                </div>
                <div className='messages__item__metadata'>
                  {repeatedAuthor ? null : <div className='messages__item__metadata__name'>{message.author || 'conspirator'}{renderDate(message.time)}</div>}
                  <div className={repeatedAuthor ? 'text indent' : 'text'}>
                    {enrichText(message.content)}
                  </div>
                </div>
              </div>
            )
          }
          if (message.type === 'chat/emote') {
            return (
              <div key={index} className='messages__item messages__item--emote'>
                <div className='messages__item__avatar'>
                  <div className='messages__item__avatar__img'>
                    {repeatedAuthor ? null : <Avatar name={message.author || 'conspirator'} />}
                  </div>
                </div>
                <div className='messages__item__metadata'>
                  {repeatedAuthor ? null : <div className='messages__item__metadata__name'>{message.author}{renderDate(message.time)}</div>}
                  <div className={repeatedAuthor ? 'text indent' : 'text'}>{enrichText(message.content)}</div>
                </div>
              </div>
            )
          }
        })}
      </div>
    )
  }
}
