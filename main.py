#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, time, datetime, random, json, re, csv
from functools import partial
from collections import deque
from tornado import websocket, web, ioloop, httpclient, httputil, gen
import gmusicapi as gm

VERSION = datetime.datetime.fromtimestamp(os.path.getmtime(__file__)).strftime('%Y%m%d')[-5:]
ROOT_PATH = os.path.dirname(os.path.realpath(__file__))

# Class for saving and loading configuration files
class Config:
	config = {}

	@classmethod
	def load(cls, path):
		try:
			with open(path, 'r') as f:
				lines = f.readlines()
				for l in lines:
					kv = l.split(':', 1)
					cls.config[kv[0].strip()] = kv[1].strip()
		except:
			print('Error loading config file {}'.format(path))
			cls.config = {}

	@classmethod
	def get(cls, key):
		if key in cls.config:
			return cls.config[key]
		else:
			print('{} not defined in config!'.format(key))
			return ''

# Class for managing music library
class Library:
	ALPHA = 2

	path = ''
	data = {}
	error_count = 0
	api = gm.Mobileclient(debug_logging=False)
	logged_in = False

	@classmethod
	def load(cls, path):
		cls.path = path
		try:
			with open(cls.path, 'r') as f:
				reader = csv.reader(f)
				for row in reader:
					cls.data[row[0]] = {
						'name': row[1],
						'rank': int(row[2]),
					}
		except:
			print('Error loading data file {}'.format(cls.path))
			cls.data = {}

	@classmethod
	def save(cls):
		try:
			with open(cls.path, 'w') as f:
				writer = csv.writer(f)
				for k, v in cls.data.items():
					writer.writerow([k, v['name'], v['rank']])
		except:
			print('Error saving data file {}'.format(cls.path))

	@classmethod
	def login(cls, email, password, android_id):
		cls.api.login(email, password, android_id)
		print('Login success!')
		cls.logged_in = True
		cls.refresh()
		
	@classmethod
	def refresh(cls):
		if not cls.logged_in:
			print('Not logged in!')
			return
		cls.library = cls.api.get_all_songs()
		new_data = {}
		for song in cls.library:
			new_data[song['id']] = {
				'name':	song['title']
			}
			if song['id'] in cls.data:
				new_data[song['id']]['rank'] = cls.data[song['id']]['rank']
			else:
				new_data[song['id']]['rank'] = 256
		cls.data = new_data
	
	@classmethod
	def get(cls):
		if not cls.logged_in:
			return
		total = 0.0
		for k, v in cls.data.items():
			total += cls.ALPHA ** v['rank']
		r = random.uniform(0, total)
		for song in cls.library:
			r -= cls.ALPHA ** cls.data[song['id']]['rank']
			if r <= 0:
				return song

	@classmethod
	def geturl(cls, song):
		try:
			return cls.api.get_stream_url(song['id'])
		except gm.exceptions.CallFailure:
			cls.error_count += 1
			cls.refresh()
			if cls.error_count > 10:
				cls.error_count = 0
				print('Failed to fetch streaming URL!')
				return ''
			return cls.geturl(song)

	@classmethod
	def getrank(cls, song):
		if song['id'] in cls.data:
			return cls.data[song['id']]['rank']
		else:
			return 0

	@classmethod
	def setrank(cls, song, rank):
		cls.data[song['id']]['rank'] = rank

# Class for requesting mp3 files
class Requestor:
	MAX_SIZE = 10
	current_id = 0
	minimum_id = 0
	data = {}
	
	@classmethod
	def __make_header_callback(cls):
		def callback(cls, id, line):
			if not id in cls.data:
				raise httpclient.HTTPError(408, 'Obsolete request #{} dropped.'.format(id))
			if re.match('Content-Length', line):
				header = httputil.HTTPHeaders.parse(line)
				cls.data[id]['expected_size'] = int(header.get('Content-Length'))
		return partial(callback, cls, cls.current_id)

	@classmethod
	def __make_content_callback(cls):
		def callback(cls, id, data):
			if not id in cls.data:
				raise httpclient.HTTPError(408, 'Obsolete request #{} dropped.'.format(id))
			cls.data[id]['data'].extend(data)
		return partial(callback, cls, cls.current_id)

	@classmethod
	def __make_final_callback(cls):
		def callback(cls, id, response):
			if not id in cls.data:
				return
			if len(cls.data[id]['data']) != cls.data[id]['expected_size']:
				print('Request did not finish.')
				if response.error:
					print('Error: {}'.format(response.error))
				del cls.data[id]
		return partial(callback, cls, cls.current_id)

	@classmethod
	def __prepare(cls, name):
		cls.current_id += 1
		cls.data[cls.current_id] = {
			'name': name,
			'data': bytearray(),
			'expected_size': 0,
		}
	
	@classmethod
	def __clean(cls):
		if len(cls.data) > cls.MAX_SIZE:
			cls.minimum_id = min(cls.data.keys())
			del cls.data[cls.minimum_id]

	@classmethod
	async def request(cls, name, url):
		cls.__prepare(name)
		http_request = httpclient.HTTPRequest(url, header_callback=cls.__make_header_callback(), streaming_callback=cls.__make_content_callback())
		try:
			response = await httpclient.AsyncHTTPClient().fetch(http_request, cls.__make_final_callback(), raise_error=False)
		except:
			print('Request failed.')
		cls.__clean()

	@classmethod
	def get(cls, name):
		for k, v in cls.data.items():
			if v['name'] == name:
				return v['data']
		return []

	@classmethod
	def get_expected_size(cls, name):
		for k, v in cls.data.items():
			if v['name'] == name:
				return v['expected_size']
		return 0
				
# Handler for serving mp3 files
class StreamHandler(web.RequestHandler):
	FRAME_SIZE = 65536
	SLEEP_TIME = 0.05
	
	@web.asynchronous
	def get(self):
		self.name = self.get_argument('name')
		self.expected_size = Requestor.get_expected_size(self.name)
		self.written = 0

		self.set_header('Content-Type', 'audio/mp3')
		self.set_header('Accept-Ranges', 'bytes')
		self.set_header('Cache-Control', 'no-store')
		
		if self.expected_size == 0:
			self.set_status(204)
			self.finish()
			return
		
		request_range = self.request.headers.get('Range', '')
		if re.fullmatch('bytes=[0-9]*-', request_range):
			self.written = int(request_range[6:-1])
			self.set_status(206)
			self.set_header('Content-Range', 'bytes {}-{}/{}'.format(self.written, self.expected_size-1, self.expected_size))
		self.set_header('Content-Length', self.expected_size - self.written)

		self.flush()
		self.__write_frame()
	
	def __write_frame(self):
		self.expected_size = Requestor.get_expected_size(self.name)
		if self.expected_size > 0 and self.written == self.expected_size:
			self.finish()
			return
		
		data = Requestor.get(self.name)
		if len(data) < min(self.written + self.FRAME_SIZE, Requestor.get_expected_size(self.name)):
			ioloop.IOLoop.current().call_later(self.SLEEP_TIME, self.__write_frame)
			return
		
		frame = data[self.written : self.written + self.FRAME_SIZE]
		self.write(bytes(frame))
		self.written += len(frame)
		self.flush(callback=self.__write_frame)

# Class for requesting mp3 files
class Player:
	MAX_SIZE = 5
	
	queue = deque()
	next = 0	# 0: Default +1: Loop -1: Skip
	start_time = 0

	@classmethod
	def update(cls):
		while len(cls.queue) < cls.MAX_SIZE:
			song = Library.get()
			cls.queue.append(song)
			url = Library.geturl(song)
			ioloop.IOLoop.current().add_callback(Requestor.request, song['id'], url)			
			
		if cls.next == -1:
			cls.start_time = 0
		if time.time() - cls.start_time > int(cls.getplaying()['durationMillis']) / 1000:
			cls.start_time = 0
			
		if cls.start_time == 0:
			if cls.next != 1:
				cls.queue.popleft()
			
			cls.next = 0
			MessageHandler.send_ack('next', 0)
			cls.start_time = time.time()
			MessageHandler.send_update(cls.getplaying())

	@classmethod
	def getplaying(cls):
		return cls.queue[0]
	
	@classmethod
	def gettime(cls):
		return time.time() - cls.start_time
	
	@classmethod
	def getnext(cls):
		return cls.next
	
	@classmethod
	def setnext(cls, next):
		cls.next = next

# Handler for sending and receving messsages through websocket
class MessageHandler(websocket.WebSocketHandler):
	clients = set()
	messages = deque()

	@classmethod
	def broadcast(cls):
		while len(cls.messages) > 0:
			msg = cls.messages.popleft()
			for c in cls.clients.copy():
				try:
					c.write_message(msg)
				except:
					print('Failed to send message {}!'.format(msg))
					
	@staticmethod
	def __make_update_msg(song):
		message = {
			'type': 'update',
			'id': song['id'],
			'title': song['title'],
			'artist': song['artist'],
			'album': song['album'],
			'albumArt': '',
			'duration': song['durationMillis'],
			'score': Library.getrank(song),
			'extra': song['comment'],
			'time': Player.gettime()
		}
		if 'albumArtRef' in song:
			message['albumArt'] = song['albumArtRef'][0]['url']
		return message

	@classmethod
	def send_update(cls, song):
		cls.messages.append(cls.__make_update_msg(song))

	@staticmethod
	def __make_ack_msg(key, value):
		message = {
			'type': 'ack',
			'key': key,
			'value': value,
		}
		return message

	@classmethod
	def send_ack(cls, key, value):
		cls.messages.append(cls.__make_ack_msg(key, value))
	
	def open(self):
		self.clients.add(self)
		self.write_message(self.__make_ack_msg('version', VERSION))
		self.write_message(self.__make_ack_msg('next', Player.getnext()))
		self.write_message(self.__make_update_msg(Player.getplaying()))

	def on_message(self, msg):
		message = json.loads(msg)
		if message['key'] == 'next':
			Player.setnext(message['value'])
			self.send_ack('next', Player.getnext())
		elif message['key'] == 'score':
			Library.setrank(Player.getplaying(), message['value'])
			self.send_ack('score', message['value'])
		elif message['key'] == 'time':
			self.send_ack('time', Player.gettime())
		else:
			print('Unknown incoming message {}'.format(message))
			
	def on_close(self):
		self.clients.remove(self)
		
# Init
Config.load(os.path.join(ROOT_PATH, 'config.txt'))
Library.load(os.path.join(ROOT_PATH, 'data.txt'))
Library.login(Config.get('email'), Config.get('password'), Config.get('android_id'))
	
# Start web server
app = web.Application([
	('/get', StreamHandler),
	('/socket', MessageHandler),
	('/', web.RedirectHandler, {'url': '/index.html'}),
	('/(.*)', web.StaticFileHandler, {'path': os.path.join(ROOT_PATH, 'static')}),
])
app.listen(Config.get('port'), ssl_options={
	'certfile': Config.get('certfile'),
	'keyfile': Config.get('keyfile'),
})
ioloop.PeriodicCallback(MessageHandler.broadcast, 50).start()
ioloop.PeriodicCallback(Player.update, 150).start()
ioloop.PeriodicCallback(Library.save, 60000).start()
ioloop.PeriodicCallback(Library.refresh, 300000).start()
ioloop.IOLoop.current().start()
