'use strict';
const VERSION = 59;

const X_BLOCKS = 32;
const Y_BLOCKS = 16;
const BRIGHTNESS = [0.5, 0.5, 0.5];
const COLOR = {
	LOW: '#7e4c70',
	HIGH: '#fd99e1',
	HIGH2: '#66ccff',
};
const MAX_STAR = 7;

var LATENCY = 0;
var LYRIC_LATENCY = 0;

// Audio context
const audioCtx = new window.AudioContext();
// Main gain node, 50% volume
const gainNode = audioCtx.createGain();
gainNode.gain.value = 0.25;
// Analyser node for spectrum
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 1024;
analyser.connect(gainNode);
gainNode.connect(audioCtx.destination);
// Karaoke processor
const splitter = audioCtx.createChannelSplitter(2);
const gainNodeL = audioCtx.createGain();
const gainNodeR = audioCtx.createGain();
splitter.connect(gainNodeL, 0);
splitter.connect(gainNodeR, 1);

function karaoke(status) {
	if (status > 0 && status <= 1) {
		// Turn on karaoke mode. Connect gain node to splitter and sub-channel gain node to output.
		gainNodeL.gain.value = 1;
		gainNodeR.gain.value = -status;
		gainNode.disconnect(audioCtx.destination);
		gainNode.connect(splitter);
		gainNodeL.connect(audioCtx.destination);
		gainNodeR.connect(audioCtx.destination);
		console.log("Karaoke mode ON");
	}
	else {
		// Turn off karaoke mode. Connect gain node to output directly.
		gainNodeL.disconnect(audioCtx.destination);
		gainNodeR.disconnect(audioCtx.destination);
		gainNode.disconnect(splitter);
		gainNode.connect(audioCtx.destination);
		console.log("Karaoke mode OFF");
	}
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}
var shuffledIndex = [];
for (let i = 0; i < X_BLOCKS * Y_BLOCKS; i++) {
	shuffledIndex.push(i);
}
shuffleArray(shuffledIndex);
var shuffledColorMap = [];
for (let i = 0; i < X_BLOCKS * Y_BLOCKS; i++) {
	const hue = 360 * i / (X_BLOCKS * Y_BLOCKS);
	const r = 1 - Math.abs((hue / 60) % 2 - 1);
	if (hue < 60) {
		shuffledColorMap.push([1, r, 0]);
	}
	else if (hue < 120) {
		shuffledColorMap.push([r, 1, 0]);
	}
	else if (hue < 180) {
		shuffledColorMap.push([0, 1, r]);
	}
	else if (hue < 240) {
		shuffledColorMap.push([0, r, 1]);
	}
	else if (hue < 300) {
		shuffledColorMap.push([r, 0, 1]);
	}
	else {
		shuffledColorMap.push([1, 0, r]);
	}
}
shuffleArray(shuffledColorMap);

// Kuroshiro
const kuroshiro = new Kuroshiro();
kuroshiro.ready = false;
kuroshiro.init(new KuromojiAnalyzer({dictPath: 'dict'})).then(async function(){
	kuroshiro.ready = true;
	for (let i = 0; i < lyric.length; i++) {
		lyric[i][1] = await addYomi(lyric[i][1]);
	}
});

// Convert second value to mm:ss format
function secondToString(sec) {
	sec = Math.max(sec, 0)
	const hour = Math.floor(sec / 3600);
	let minute = Math.floor((sec / 60) % 60);
	let second = Math.floor(sec % 60);
	minute = minute < 10 ? '0' + minute : minute;
	second = second < 10 ? '0' + second : second;
	return hour > 0 ? hour + ':' + minute + ':' + second : minute + ':' + second;
}	

// Convert mm:ss.ss to second
function stringToSecond(str) {
	const parsed = str.match(/([0-9]{2})\:([0-9]{2})\.([0-9]{2})/);
	return parseInt(parsed[1]) * 60 + parseInt(parsed[2]) + parseInt(parsed[3]) / 100;
}

// Set star colors
function drawStar(s) {
	s = parseInt(s)
	for (let i = 1; i <= s; i++)
		$('#star' + i).css('color', COLOR.HIGH);
	for (let i = s + 1; i <= MAX_STAR; i++)
		$('#star' + i).css('color', COLOR.LOW);
}

// Clear all status
function clear() {
	$('#id').empty();
	$('#title').empty();
	$('#artist').empty();
	$('#album').empty();
	$('#albumArt').attr('src', 'default.png');
	$('#time_cur').empty();
	$('#time_dur').empty();
	drawStar(0);
	$('#progress').attr('value', 0);
	$('#lyric-text').empty();
};

// Draw canvas background
function draw(ctx, data) {
	for (let x = 0; x < X_BLOCKS; x++) {
		for (let y = 0; y < Y_BLOCKS; y++) {
			const index = y * X_BLOCKS + x;
			const value = Math.max(data[shuffledIndex[index]] - 128, 0);
			const red = Math.floor(shuffledColorMap[index][0] * BRIGHTNESS[0] * value);
			const green = Math.floor(shuffledColorMap[index][1] * BRIGHTNESS[1] * value);
			const blue = Math.floor(shuffledColorMap[index][2] * BRIGHTNESS[2] * value);
			
			ctx.fillStyle = 'rgb(' + red + ',' + green + ',' + blue + ')';
			ctx.fillRect(x*canvas.width/X_BLOCKS, y*canvas.height/Y_BLOCKS, canvas.width/X_BLOCKS, canvas.height/Y_BLOCKS);
		}
	}
}

// Return a function that only loads the audio if id matches expected value
function getAudioLoader() {
	var id = $('#id').html();
	return function(){
		if ($('#id').html() == id) {
			$('audio').get(0).load();
		}
		else {
			console.log('Request skipped');
		}
	};
}

var lyric = [];
async function addYomi(input) {
	if (input.match('<ruby>')) {
		return input;
	}
	let result = await kuroshiro.convert(input, {'mode': 'furigana'});
	if (!result) {
		result = '&nbsp;'
	}
	if (!result.match('<ruby>')) {
		result = '<ruby><rb>' + result + '</rb><rt>&nbsp;</rt></ruby>';
	}
	return result;
}
async function parseLyric(message) {
	const lyricArray = [];
	const lyricLines = message.match(/\[[0-9]{2}\:[0-9]{2}\.[0-9]{2}\][^\[]*/g);
	if (!lyricLines) {
		return lyricArray;
	}
	for (let i = 0; i < lyricLines.length; i++) {
		const line = lyricLines[i];
		const parsedLine = line.match(/\[(.*)\](.*)/);
		if (!parsedLine) {
			console.log('Error parsing lyric: ' + line);
			return lyricArray;
		}
		const time = stringToSecond(parsedLine[1]);
		if (kuroshiro.ready) {
			lyricArray.push([time, await addYomi(parsedLine[2])]);
		}
		else {
			lyricArray.push([time, parsedLine[2]]);
		}
	}
	return lyricArray;
}

function update(canvasCtx) {
	const time = $('audio').prop('currentTime');
	$('#time_cur').html(secondToString(time));
	$('#progress').attr('value', time);
	
	if (lyric.length > 0) {
		const adjustedTime = time - LYRIC_LATENCY;
		while (lyric.length > 1 && adjustedTime >= lyric[1][0]) {
			lyric.shift();
		}
		if (lyric.length > 0 && adjustedTime >= lyric[0][0]) {
			$('#lyric-text').html(lyric[0][1]);			
		}
		$('#lyric-hint').css('color', COLOR.HIGH);
	}
	else {
		$('#lyric-text').empty();
		$('#lyric-hint').css('color', COLOR.LOW);
	}
			
	const freqData = new Uint8Array(analyser.frequencyBinCount);
	const timeData = new Uint8Array(analyser.fftSize);
	analyser.getByteFrequencyData(freqData);
	analyser.getByteTimeDomainData(timeData);
	draw(canvasCtx, freqData);
}

$(function(){
	// Initialize audio source
	var source = audioCtx.createMediaElementSource($('audio').get(0)).connect(analyser);
	$('source').on('error', function(){
		if (this.src == '')
			return;

		LATENCY = Math.min(LATENCY + 0.2, 2);
		console.log('Increasing latency to ' + LATENCY);
		
		setTimeout(getAudioLoader(), 200);
	});
	
	function playAudio() {
		var promise = $('audio').get(0).play();
		if (promise !== undefined) {
			promise.then(_ => {
				$('#play').css('color', COLOR.HIGH);
			}).catch(error => {
				$('#play').css('color', COLOR.LOW);
				console.log('Failed to play!');
			});
		}
	};
	$('audio').on('loadeddata', playAudio);
	// Manual play button
	$('#play').on('click', function(){
		if ($('audio').prop('paused')) {
			audioCtx.resume();
			ws.update('time', 0);
		}
	});
	
	// Canvas context
	var canvasCtx = document.getElementById("canvas").getContext("2d");

	// WebSocket
	var ws = new WebSocket('wss://ijk.moe:7650/socket');
	ws.onopen = function() {
		console.log('Socket connected');
		$('#misc').append('Client v' + VERSION + '<br>');
		$('.status').css('color', COLOR.HIGH);
		$('.status2').css('color', COLOR.HIGH2);
		clear();
	};
	ws.onclose = function() {
		console.log('Socket disconnected');
		$('audio').get(0).pause();
		$('#wrapper').html('<span class="error">ERROR: Connection closed</span>');
		$('#footer').html('');
	};
	ws.onerror = ws.onclose;
	ws.onmessage = async function(e) {
		var msg = JSON.parse(e.data);

		if (msg.type == 'update') {
			$('#id').html(msg.id);
			document.title = msg.title;
			$('#title').html(msg.title);
			$('#artist').html(msg.artist);
			$('#album').html(msg.album);
			$('#albumArt').attr('src', msg.albumArt ? msg.albumArt.replace('http://', 'https://') : 'default.png');

			$('#star').attr('score', msg.score);
			drawStar(msg.score);

			$('#time_dur').html(secondToString(msg.duration / 1000));
			$('#progress').attr('max', msg.duration / 1000);

			lyric = msg.extra ? await parseLyric(msg.extra) : [];
			
			$('source').attr('src', '/get?t=' + new Date().getTime() + '&name=' + $('#id').html());
			if (msg.time > LATENCY) {
				$('audio').get(0).pause();
				$('audio').get(0).load();
				$('audio').prop('currentTime', msg.time - LATENCY);
			}
			else {
				$('audio').get(0).pause();
				$('audio').prop('currentTime', 0);
				setTimeout(getAudioLoader(), LATENCY * 1000);
			}
		}
		else if (msg.type == 'msg') {
			$('#misc').append('*' + msg.value + '<br>');
		}
		else if (msg.type == 'ack') {
			if (msg.key == 'version') {
				$('#misc').append('Server v' + msg.value + '<br>');
			}
			else if (msg.key == 'next') {
				$('#next-1').css('color', msg.value == -1 ? COLOR.HIGH : COLOR.LOW);
				$('#next1').css('color', msg.value == 1 ? COLOR.HIGH : COLOR.LOW);
			}
			else if (msg.key == 'score') {
				$('#star').attr('score', msg.value);
				drawStar(msg.value);
			}
			else if (msg.key == 'time') {
				$('audio').prop('currentTime', msg.value - LATENCY);
				playAudio();
			}
		}
	};
	// Update the data of current song through WebSocket
	ws.update = function(key, value) {
		ws.send('{"key": "' + key + '", "value": ' + value + '}');
	}
	
	// Set page orientation
	var totalWidth = $('#footer').css('width').slice(0, -2) - 16;
	var mainWidth = totalWidth - $('#side1').css('width').slice(0, -2) - $('#side2').css('width').slice(0, -2) - 40;
	if (mainWidth / totalWidth > 0.5) {
		$('#main').css('max-width', mainWidth + 'px');
	}
	else {
		$('#main').css('max-width', totalWidth + 'px');		
	}

	// Volume slider
	$('#vol_value').html($('#volume').val());
	$('#volume').on('change', function() {
		$('#vol_value').html($(this).val());
		gainNode.gain.value = ($(this).val() / 100) ** 2;
	});

	// Next button handler
	function setNext(value) {
		if ((value != 1) && (value != -1)) {
			return;
		}	
		$('#next' + value).css('color', COLOR.HIGH);
		ws.update('next', value);
	}
	$('#next1').on('click', setNext.bind(null, 1));
	$('#next-1').on('click', setNext.bind(null, -1));
	
	// Set stars behaviour
	for (let i = 1; i <= MAX_STAR; i++) {
		const elem = $('<span id="star' + i + '"></span>').html('&#x2605;');
		elem.attr('star', i);
		elem.css('margin', '0.1em');
		elem.on('mouseover', function() {
			drawStar($(this).attr('star'));
		});
		elem.on('mouseout', function() {
			drawStar($('#star').attr('score'));
		});
		elem.on('click', function() {
			ws.update('score', $(this).attr('star'));			
		});
		$('#star').append(elem);
	}
	
	//Shortcut keys
	$('body').keydown(function(e) {
		//Star
		if (e.which >= (48 + 1) && e.which <= (48 + MAX_STAR)) {
			e.preventDefault();
			ws.update('score', e.which - 48);
		}
		//Numkey Star
		else if (e.which >= (96 + 1) && e.which <= (96 + MAX_STAR)) {
			e.preventDefault();
			ws.update('score', e.which - 96);
		}
		//+
		else if (e.which == 107 || e.which == 187) {
			e.preventDefault();
			setNext(+1);
		}
		//-
		else if (e.which == 109 || e.which == 189) {
			e.preventDefault();
			setNext(-1);
		}
		else if (e.which == 90) {
			e.preventDefault();
			var z = $('#canvas').css('z-index');
			$('#canvas').css('z-index', -z);
		}
	});
	$(window).on('unload', function() {
		ws.close();
	});

	clear();
	setInterval(update.bind(null, canvasCtx), 100);
});
