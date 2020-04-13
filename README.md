# homebridge-telenet-tv-box

`homebridge-telenet-tv-box` is a Homebridge plugin allowing you to control your tv-box & any connected HDMI-CEC controllable devices with the Apple Home app & Control Centre remote!

The Telenet TV-box will display as a TV Accessory with Power, Input & Remote Control.

## Requirements
* iOS 12.2 (or later)
* [Homebridge](https://homebridge.io/) v0.4.46 (or later)

## Installation
Install homebridge-telenet-tv-box:
```sh
npm install -g homebridge-telenet-tv-box
```

## Usage Notes
Quickly switch input using the information (i) button in the Control Centre remote

## Configuration
Add a new platform to your homebridge `config.json`.

Specific "favourite" inputs can be added manually or all available inputs reported by the AVR will be set.

Example configuration:

```js
{
    "platforms": [
      {
        "platform": "telenet-tv-box",
        "name": "Telenet TV-box",
        "username": "youremail@telenet.be",
        "password": "Your Telenet-password"
      }
    ]
  }
```

## Thanks to
[homebridge-ziggo-next](https://github.com/KixAss/homebridge-ziggo-next)
