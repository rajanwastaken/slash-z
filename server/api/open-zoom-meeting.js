const ZoomClient = require('./zoom-client')
const AirBridge = require("./airbridge")
const closeZoomCall = require('./close-zoom-call')

module.exports = async () => {
  // find an open host w/ less then 2 open meetings. why 2? Zoom lets us host up to 2 concurrent meetings
  // https://support.zoom.us/hc/en-us/articles/206122046-Can-I-Host-Concurrent-Meetings-
  // ¯\_(ツ)_/¯
  let host = await AirBridge.find('Hosts', {filterByFormula:'{Open Meetings}<2'})

  // no free hosts? let's try closing some stale zoom calls
  if (!host) {
    const cutoff = 60*2 // 2 minutes
    const staleCalls = await AirBridge.get('Meetings', {filterByFormula: `AND({status}='OPEN', DATETIME_DIFF(NOW(),{Started At})>${cutoff})`})
    if (staleCalls.length > 0) {
      console.log(`No free hosts! I found ${staleCalls} meeting(s) that might be over, so I'll try closing them & trying again`)
      await Promise.all(staleCalls.map(async (call) => {
        closeZoomCall(call.fields['Zoom ID'])
      }))
      console.log("Now let's see if there's another open host...")
      host = await AirBridge.find('Hosts', {filterByFormula:'{Open Meetings}<2'})
    }
  }

  // still no free host? uh oh! let's reply back with an error
  if (!host) {
    throw new Error('out of open hosts!')
  }

  // make a zoom client for the open host
  const zoom = new ZoomClient({zoomSecret: host.fields['API Secret'], zoomKey: host.fields['API Key']})

  // no zoom id? no problem! let's figure it out and cache it for next time
  if (!host.fields['Zoom ID'] || host.fields['Zoom ID'] == '') {
    // get the user's zoom id
    const hostZoom = await zoom.get({ path: `users/${host.fields['Email']}` })
    host = await AirBridge.patch('Hosts', host.id, {'Zoom ID': hostZoom.id})

    zoomUser = await zoom.patch({path: `users/${host.fields['Zoom ID']}/settings`, body: {
      meeting_security: {
        embed_password_in_join_link: true
      },
    }})
  }

  const hostKey = Math.random().toString().substr(2,6).padEnd(6,0)
  await zoom.patch({ path: `users/${host.fields['Zoom ID']}`, body: { host_key: hostKey}})

  // start a meeting with the zoom client
  const meeting = await zoom.post({
    path: `users/${host.fields['Zoom ID']}/meetings`,
    body: {
      type: 2, // type 2 == scheduled meeting
      host_video: true,
      participant_video: true,
      join_before_host: true,
    }
  })

  return {
    ...meeting,
    hostID: host.id
  }
}