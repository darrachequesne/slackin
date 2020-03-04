import request from 'superagent'
import { EventEmitter } from 'events'

export default class SlackData extends EventEmitter {

  constructor ({ token, interval, org: host }){
    super()
    this.host = host
    this.token = token
    this.interval = interval
    this.ready = false
    this.org = {}
    this.users = {}
    this.channelsByName = {}
    this.generalChannelId = ""
    this.init()
  }

  initChannels() {
    return new Promise((resolve, reject) => {
      request
        .get(`https://${this.host}.slack.com/api/channels.list`)
        .query({ token: this.token, exclude_archived: true, exclude_members: true })
        .end((err, res) => {
          if (err) {
            return reject(err)
          }
          (res.body.channels || []).forEach(channel => {
            this.channelsByName[channel.name] = channel
            if (channel.name === "general") {
              this.generalChannelId = channel.id
            }
          })
          if (!this.generalChannelId) {
            return reject(new Error("'#general' channel was not found"))
          }
          resolve()
        })
    })
  }

  initOrg() {
    return new Promise((resolve, reject) => {
      request
        .get(`https://${this.host}.slack.com/api/team.info`)
        .query({ token: this.token })
        .end((err, res) => {
          if (err) {
            return reject(err)
          }
          let team = res.body.team
          if (!team) {
            throw new Error('Bad Slack response. Make sure the team name and API keys are correct');
          }
          this.org.name = team.name
          if (!team.icon.image_default) {
            this.org.logo = team.icon.image_132
          }
          resolve()
        })
    })
  }

  async init() {
    await Promise.all([ this.initChannels(), this.initOrg() ])
    this.fetch()
  }

  fetch (){
    request
      .get(`https://${this.host}.slack.com/api/conversations.info`)
      .query({ token: this.token, channel: this.generalChannelId, include_num_members: true })
      .end((err, res) => {
        this.onres(err, res)
      })
    this.emit('fetch')
  }

  getChannelId (name){
    let channel = this.channelsByName[name]
    return channel ? channel.id: null
  }

  retry (){
    let interval = this.interval * 2
    setTimeout(this.fetch.bind(this), interval)
    this.emit('retry')
  }

  onres (err, res){
    if (err) {
      this.emit('error', err)
      return this.retry()
    }

    let total = res.body.channel.num_members
    let active = 42 // unable to fetch the presence for that many users

    if (this.users) {
      if (total != this.users.total) {
        this.emit('change', 'total', total)
      }
      if (active != this.users.active) {
        this.emit('change', 'active', active)
      }
    }

    this.users.total = total
    this.users.active = active

    if (!this.ready) {
      this.ready = true
      this.emit('ready')
    }

    setTimeout(this.fetch.bind(this), this.interval)
    this.emit('data')
  }

}
