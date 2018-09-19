'use strict';

var VERSION = 51;

var LATENCY = 0.6;

var X_BLOCKS = 32;
var Y_BLOCKS = 16;
var BRIGHTNESS = [0.5, 0.5, 0.5];

var COLOR = {
	LOW: '#7e4c70',
	HIGH: '#fd99e1',
	HIGH2: '#66ccff',
};

var MAX_STAR = 7;

var audioCtx = new window.AudioContext();

var gainNode = audioCtx.createGain();
gainNode.gain.value = 0.25;		//50% volume
var analyser = audioCtx.createAnalyser();
analyser.fftSize = 1024;
analyser.connect(gainNode);
gainNode.connect(audioCtx.destination);

function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}
var shuffledIndex = [];
for (var i = 0; i < X_BLOCKS * Y_BLOCKS; i++) {
	shuffledIndex.push(i);
}
shuffleArray(shuffledIndex);
var shuffledColorMap = [];
for (var i = 0; i < X_BLOCKS * Y_BLOCKS; i++) {
	var hue = 360 * i / (X_BLOCKS * Y_BLOCKS);
	var r = 1 - Math.abs((hue / 60) % 2 - 1);
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

// Convert second value to mm:ss format
function secondToString(sec) {
	sec = Math.max(sec, 0)
	var hour = Math.floor(sec / 3600);
	var minute = Math.floor((sec / 60) % 60);
	var second = Math.floor(sec % 60);
	minute = minute < 10 ? '0' + minute : minute;
	second = second < 10 ? '0' + second : second;
	return hour > 0 ? hour + ':' + minute + ':' + second : minute + ':' + second;
}	

// Convert mm:ss.ss to second
function stringToSecond(str) {
	var parsed = str.match(/([0-9]{2})\:([0-9]{2})\.([0-9]{2})/);
	return parseInt(parsed[1]) * 60 + parseInt(parsed[2]) + parseInt(parsed[3]) / 100;
}

// Set star colors
function drawStar(s) {
	s = parseInt(s)
	for (var i=1; i<=s; i++)
		$('#star' + i).css('color', COLOR.HIGH);
	for (var i=s+1; i<=MAX_STAR; i++)
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
	for (var x = 0; x < X_BLOCKS; x++) {
		for (var y = 0; y < Y_BLOCKS; y++) {
			var index = y * X_BLOCKS + x;
			var value = Math.max(data[shuffledIndex[index]] - 128, 0);
			var red = Math.floor(shuffledColorMap[index][0] * BRIGHTNESS[0] * value);
			var green = Math.floor(shuffledColorMap[index][1] * BRIGHTNESS[1] * value);
			var blue = Math.floor(shuffledColorMap[index][2] * BRIGHTNESS[2] * value);
			
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

var lyricArray = [];
function update(canvasCtx) {
	var audioElem = $('audio').get(0);
	$('#time_cur').html(secondToString(audioElem.currentTime));
	$('#progress').attr('value', audioElem.currentTime);
	
	if (lyricArray.length > 0) {
		var lyricHead = lyricArray[0].match(/\[(.*)\](.*)/);
		while ($('audio').prop('currentTime') >= stringToSecond(lyricHead[1])) {
			$('#lyric-text').html(lyricHead[2]);
			lyricArray.shift();
			if (lyricArray.length == 0) {
				break;
			}
			lyricHead = lyricArray[0].match(/\[(.*)\](.*)/);
		}
	}
	
	var freqData = new Uint8Array(analyser.frequencyBinCount);
	var timeData = new Uint8Array(analyser.fftSize);
	analyser.getByteFrequencyData(freqData);
	analyser.getByteTimeDomainData(timeData);
	draw(canvasCtx, freqData);
	
	setTimeout(function(){
		update(canvasCtx)
	}, 100);
}

$(function(){
	// Initialize audio source
	var source = audioCtx.createMediaElementSource($('audio').get(0)).connect(analyser);
	$('source').on('error', function(){
		if (this.src == '')
			return;

		LATENCY = Math.min(LATENCY + 0.2, 3);
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
	ws.onmessage = function(e) {
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

			lyricArray = msg.extra ? msg.extra.match(/\[[0-9]{2}\:[0-9]{2}\.[0-9]{2}\][^\[]*/g) : [];
			$('#lyric-hint').css('color', lyricArray.length > 0 ? COLOR.HIGH : COLOR.LOW);
			$('#lyric-text').empty();
			
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
			else if (msg.key == 'pending') {
				$('#next').css('color', msg.value == -1 ? COLOR.HIGH : COLOR.LOW);
				$('#plus').css('color', msg.value == +1 ? COLOR.HIGH : COLOR.LOW);
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
	
	// Plus button handler
	function setPlus() {
		$('#plus').css('color', COLOR.HIGH);
		ws.update('pending', +1);
	}
	$('#plus').on('click', setPlus);

	// Next button handler
	function setNext() {
		$('#next').css('color', COLOR.HIGH);
		ws.update('pending', -1);
	}
	$('#next').on('click', setNext);
	
	//Set stars behaviour
	for (var i=1; i<=MAX_STAR; i++) {
		$('#star' + i).attr('star', i);
		$('#star' + i).on('mouseover', function() {
			drawStar($(this).attr('star'));
		});
		$('#star' + i).on('mouseout', function() {
			drawStar($('#star').attr('score'));
		});
		$('#star' + i).on('click', function() {
			ws.update('score', $(this).attr('star'));			
		});
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
			setPlus();
		}
		//-
		else if (e.which == 109 || e.which == 189) {
			setNext();
		}
		else if (e.which == 90) {
			e.preventDefault();
			var z = $('#canvas').css('z-index');
			$('#canvas').css('z-index', -z);
		}
	});
	$(window).on('unload', function() {
		ws.close();
		stream.close();
	});

	clear();
	update(canvasCtx);
});
