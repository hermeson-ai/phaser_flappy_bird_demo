/**
 * Man Down 100 - 多人游戏服务器
 * 优化版：批量下发平台初始位置，客户端本地滚动，定期校准
 */

const WebSocket = require('ws')
const http = require('http')
const path = require('path')
const fs = require('fs')

// 服务器配置
const PORT = process.env.PORT || 3000
const TICK_RATE = 20 // 服务器每秒更新次数
const PLATFORM_SYNC_INTERVAL = 100  // 平台位置校准间隔（ms）

// ========== 基础配置（与单人模式对齐）==========
const BASE_GAME_WIDTH = 320
const BASE_GAME_HEIGHT = 512
const RESOLUTION_SCALE = 3

const scaleValue = (value) => Math.round(value * RESOLUTION_SCALE)

const GAME_WIDTH = scaleValue(BASE_GAME_WIDTH)   // 960
const GAME_HEIGHT = scaleValue(BASE_GAME_HEIGHT) // 1536

// 平台相关常量
const BASE_PLATFORM_SCROLL_SPEED = -60
const BASE_PLATFORM_GAP = 100
const PLATFORM_SCROLL_SPEED = scaleValue(BASE_PLATFORM_SCROLL_SPEED)
const PLATFORM_GAP = scaleValue(BASE_PLATFORM_GAP)
const INITIAL_PLATFORM_START_Y = scaleValue(80)
const INITIAL_PLATFORM_ROWS = 7
const PLATFORM_HEIGHT = scaleValue(7)

// 预生成平台的屏幕数量（2-3屏）
const PLATFORM_PRELOAD_SCREENS = 2.5

const MAX_PLAYERS = 4
const COUNTDOWN_SECONDS = 3
const DEBUG_MODE = true

// 平台类型
const PLATFORM_TYPE = {
    NORMAL: 'normal',
    FRAGILE: 'fragile',
    BOUNCE: 'bounce',
    POISON: 'poison'
}

// 房间状态
const ROOM_STATE = {
    WAITING: 'waiting',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    FINISHED: 'finished'
}

/**
 * 玩家类 - 简化版，只存储基本信息
 */
class Player {
    constructor(id, name) {
        this.id = id
        this.name = name || `玩家${id.substring(0, 4)}`
        this.x = GAME_WIDTH / 2
        this.y = scaleValue(60)
        this.velocityX = 0
        this.velocityY = 0
        this.alive = true
        this.lives = 5
        this.level = 1
        this.ready = false
        this.lastUpdateTime = Date.now()
    }

    reset(offsetX = 0) {
        this.x = GAME_WIDTH / 2 + offsetX
        this.y = scaleValue(60)
        this.velocityX = 0
        this.velocityY = 0
        this.alive = true
        this.lives = 5
        this.level = 1
        this.lastUpdateTime = Date.now()
    }

    // 客户端上报的状态更新
    updateFromClient(data) {
        this.x = data.x
        this.y = data.y
        this.velocityX = data.velocityX || 0
        this.velocityY = data.velocityY || 0
        this.lives = data.lives
        this.level = data.level || this.level
        this.lastUpdateTime = Date.now()
    }
}

/**
 * 平台类
 */
class Platform {
    constructor(id, x, y, width, type = PLATFORM_TYPE.NORMAL) {
        this.id = id
        this.x = x
        this.y = y
        this.initialY = y  // 记录初始 y 位置，用于客户端预加载
        this.width = width
        this.height = PLATFORM_HEIGHT
        this.type = type
        this.triggered = false
        this.destroyed = false
    }
}

/**
 * 游戏房间类
 */
class GameRoom {
    constructor(id) {
        this.id = id
        this.players = new Map()
        this.platforms = []
        this.state = ROOM_STATE.WAITING
        this.platformIdCounter = 0
        this.lastPlatformY = 0
        this.currentLevel = 1
        this.countdownTimer = null
        this.countdown = COUNTDOWN_SECONDS
        this.winner = null
        this.gameLoopInterval = null
        this.platformSyncInterval = null
        this.lastUpdateTime = Date.now()
        this.gameStartTime = 0  // 游戏开始时间戳，用于计算平台当前位置
        
        // 待发送给客户端的新平台队列
        this.pendingPlatforms = []
    }

    addPlayer(playerId, playerName) {
        if (this.players.size >= MAX_PLAYERS) {
            return false
        }
        const player = new Player(playerId, playerName)
        this.players.set(playerId, player)
        return true
    }

    removePlayer(playerId) {
        this.players.delete(playerId)
        if (this.players.size === 0) {
            this.cleanup()
        }
    }

    setPlayerReady(playerId, ready) {
        const player = this.players.get(playerId)
        if (player) {
            player.ready = ready
        }
    }

    allPlayersReady() {
        if (!DEBUG_MODE && this.players.size < 2) return false
        for (const player of this.players.values()) {
            if (!player.ready) return false
        }
        return true
    }

    startCountdown(onComplete) {
        this.state = ROOM_STATE.COUNTDOWN
        this.countdown = COUNTDOWN_SECONDS
        
        this.countdownTimer = setInterval(() => {
            this.countdown--
            if (this.countdown <= 0) {
                clearInterval(this.countdownTimer)
                this.countdownTimer = null
                onComplete()
            }
        }, 1000)
    }

    startGame() {
        this.state = ROOM_STATE.PLAYING
        this.currentLevel = 1
        this.gameStartTime = Date.now()
        this.initializePlatforms()
        
        // 重置所有玩家
        let offsetX = 0
        for (const player of this.players.values()) {
            player.reset(offsetX)
            offsetX += scaleValue(33)
            if (offsetX > scaleValue(65)) offsetX = scaleValue(-65)
        }
        
        this.lastUpdateTime = Date.now()
        // 游戏逻辑更新（生成新平台、检测游戏结束）
        this.gameLoopInterval = setInterval(() => this.update(), 1000 / TICK_RATE)
    }

    // 初始化平台：预生成 2-3 屏的平台
    initializePlatforms() {
        this.platforms = []
        this.platformIdCounter = 0
        this.pendingPlatforms = []
        
        // 预生成的最大 y 值：游戏高度 * 预加载屏数
        const maxPreloadY = GAME_HEIGHT * PLATFORM_PRELOAD_SCREENS
        
        let currentY = INITIAL_PLATFORM_START_Y
        while (currentY < maxPreloadY) {
            this.createPlatformRow(currentY)
            currentY += PLATFORM_GAP
        }
        this.lastPlatformY = currentY - PLATFORM_GAP
        
        console.log(`[Room ${this.id}] 初始化平台: ${this.platforms.length} 个, 覆盖到 y=${this.lastPlatformY}`)
    }

    createPlatformRow(y) {
        const minPlatformWidth = GAME_WIDTH / 4
        const minHoleWidth = GAME_WIDTH / 3
        
        const holeWidth = minHoleWidth + Math.random() * (GAME_WIDTH / 6)
        const holeStart = Math.random() * (GAME_WIDTH - holeWidth)
        const holeEnd = holeStart + holeWidth
        
        const leftSpace = holeStart
        const rightSpace = GAME_WIDTH - holeEnd
        
        if (leftSpace >= minPlatformWidth) {
            const platformWidth = minPlatformWidth + Math.random() * (leftSpace - minPlatformWidth)
            const platformX = Math.random() * (leftSpace - platformWidth) + platformWidth / 2
            this.createSinglePlatform(platformX, y, platformWidth)
        }
        
        if (rightSpace >= minPlatformWidth) {
            const platformWidth = minPlatformWidth + Math.random() * (rightSpace - minPlatformWidth)
            const platformX = holeEnd + Math.random() * (rightSpace - platformWidth) + platformWidth / 2
            this.createSinglePlatform(platformX, y, platformWidth)
        }
    }

    createSinglePlatform(x, y, width) {
        const rand = Math.random() * 100
        let type = PLATFORM_TYPE.NORMAL
        if (rand < 20) {
            type = PLATFORM_TYPE.FRAGILE
        } else if (rand < 33) {
            type = PLATFORM_TYPE.BOUNCE
        } else if (rand < 40) {
            type = PLATFORM_TYPE.POISON
        }
        
        const platform = new Platform(this.platformIdCounter++, x, y, width, type)
        this.platforms.push(platform)
        
        // 标记为待发送的新平台
        this.pendingPlatforms.push(platform)
    }

    // 服务器更新：计算平台当前位置，生成新平台，检测游戏结束
    update() {
        if (this.state !== ROOM_STATE.PLAYING) return
        
        const now = Date.now()
        const elapsedSinceStart = (now - this.gameStartTime) / 1000  // 游戏运行时间（秒）
        
        // 计算平台当前应该的滚动偏移量
        const scrollOffset = PLATFORM_SCROLL_SPEED * elapsedSinceStart
        
        // 更新所有平台的当前 y 位置
        for (let i = this.platforms.length - 1; i >= 0; i--) {
            const platform = this.platforms[i]
            platform.y = platform.initialY + scrollOffset
            
            // 移除超出屏幕的平台
            if (platform.y < -100 || platform.destroyed) {
                this.platforms.splice(i, 1)
            }
        }
        
        // 更新最后平台的当前位置
        const lastPlatformCurrentY = this.lastPlatformY + scrollOffset
        
        // 当最后一行平台进入可视范围时，生成新的平台
        // 保持预生成 2.5 屏的平台
        const targetLastPlatformY = GAME_HEIGHT * PLATFORM_PRELOAD_SCREENS - scrollOffset
        while (this.lastPlatformY < targetLastPlatformY) {
            const newY = this.lastPlatformY + PLATFORM_GAP
            this.createPlatformRow(newY)
            this.lastPlatformY = newY
            this.currentLevel++
        }
        
        // 检查游戏结束（基于客户端上报的状态）
        let aliveCount = 0
        let lastAlivePlayer = null
        
        for (const player of this.players.values()) {
            if (player.alive) {
                aliveCount++
                lastAlivePlayer = player
            }
        }
        
        if (aliveCount <= 1 && this.players.size > 1) {
            this.endGame(lastAlivePlayer)
        } else if (aliveCount === 0) {
            this.endGame(null)
        }
    }

    // 处理客户端上报的玩家状态
    handlePlayerUpdate(playerId, data) {
        const player = this.players.get(playerId)
        if (!player || !player.alive) return
        
        player.updateFromClient(data)
        
        // 检查玩家是否死亡（客户端上报）
        if (data.died) {
            player.alive = false
            console.log(`[Room ${this.id}] ${player.name} 死亡: ${data.deathReason || '未知原因'}`)
        }
    }

    // 处理平台触发事件（客户端上报）
    handlePlatformTrigger(platformId, playerId) {
        const platform = this.platforms.find(p => p.id === platformId)
        if (!platform || platform.triggered) return
        
        platform.triggered = true
        
        if (platform.type === PLATFORM_TYPE.FRAGILE) {
            setTimeout(() => {
                platform.destroyed = true
            }, 400)
        }
        
        if (platform.type === PLATFORM_TYPE.POISON) {
            const player = this.players.get(playerId)
            if (player) {
                player.lives--
                if (player.lives <= 0) {
                    player.alive = false
                    console.log(`[Room ${this.id}] ${player.name} 死亡: HP归零`)
                }
            }
        }
    }

    endGame(winner) {
        this.state = ROOM_STATE.FINISHED
        this.winner = winner
        
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval)
            this.gameLoopInterval = null
        }
        if (this.platformSyncInterval) {
            clearInterval(this.platformSyncInterval)
            this.platformSyncInterval = null
        }
        
        console.log(`[Room ${this.id}] 游戏结束, 胜者: ${winner ? winner.name : '无'}`)
    }

    cleanup() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer)
            this.countdownTimer = null
        }
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval)
            this.gameLoopInterval = null
        }
        if (this.platformSyncInterval) {
            clearInterval(this.platformSyncInterval)
            this.platformSyncInterval = null
        }
    }

    // 获取完整状态（包含所有平台的当前位置，用于校准）
    getState() {
        const players = []
        for (const player of this.players.values()) {
            players.push({
                id: player.id,
                name: player.name,
                x: player.x,
                y: player.y,
                velocityX: player.velocityX,
                velocityY: player.velocityY,
                alive: player.alive,
                lives: player.lives,
                level: player.level,
                ready: player.ready
            })
        }
        
        return {
            roomId: this.id,
            state: this.state,
            countdown: this.countdown,
            currentLevel: this.currentLevel,
            platformScrollSpeed: PLATFORM_SCROLL_SPEED,
            gameStartTime: this.gameStartTime,
            serverTime: Date.now(),
            players: players,
            platforms: this.platforms.filter(p => !p.destroyed).map(p => ({
                id: p.id,
                x: p.x,
                y: p.y,  // 当前 y 位置
                initialY: p.initialY,  // 初始 y 位置
                width: p.width,
                height: p.height,
                type: p.type,
                triggered: p.triggered
            })),
            winner: this.winner ? {
                id: this.winner.id,
                name: this.winner.name,
                level: this.winner.level
            } : null
        }
    }

    // 获取新生成的平台（增量更新）
    getNewPlatforms() {
        const newPlatforms = this.pendingPlatforms.map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            initialY: p.initialY,
            width: p.width,
            height: p.height,
            type: p.type,
            triggered: p.triggered
        }))
        this.pendingPlatforms = []
        return newPlatforms
    }

    // 获取平台校准数据（只包含 id 和当前 y）
    getPlatformCalibration() {
        return {
            serverTime: Date.now(),
            gameStartTime: this.gameStartTime,
            platforms: this.platforms.filter(p => !p.destroyed).map(p => ({
                id: p.id,
                y: p.y
            }))
        }
    }
}

/**
 * 游戏服务器类
 */
class GameServer {
    constructor() {
        this.rooms = new Map()
        this.playerRooms = new Map()
        this.clients = new Map()
    }

    createRoom() {
        const roomId = this.generateRoomId()
        const room = new GameRoom(roomId)
        this.rooms.set(roomId, room)
        console.log(`[Server] 创建房间: ${roomId}`)
        return room
    }

    getRoom(roomId) {
        return this.rooms.get(roomId)
    }

    findAvailableRoom() {
        for (const room of this.rooms.values()) {
            if (room.state === ROOM_STATE.WAITING && room.players.size < MAX_PLAYERS) {
                return room
            }
        }
        return this.createRoom()
    }

    removeRoom(roomId) {
        const room = this.rooms.get(roomId)
        if (room) {
            room.cleanup()
            this.rooms.delete(roomId)
            console.log(`[Server] 移除房间: ${roomId}`)
        }
    }

    generateRoomId() {
        return Math.random().toString(36).substring(2, 8).toUpperCase()
    }

    handleConnection(ws) {
        const playerId = this.generatePlayerId()
        this.clients.set(playerId, ws)
        
        console.log(`[Server] 玩家连接: ${playerId}`)
        
        this.send(ws, {
            type: 'connected',
            playerId: playerId,
            gameConfig: {
                width: GAME_WIDTH,
                height: GAME_HEIGHT,
                platformScrollSpeed: PLATFORM_SCROLL_SPEED,
                platformGap: PLATFORM_GAP
            }
        })

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data)
                this.handleMessage(playerId, ws, message)
            } catch (e) {
                console.error('[Server] 消息解析错误:', e)
            }
        })

        ws.on('close', () => {
            this.handleDisconnect(playerId)
        })

        ws.on('error', (err) => {
            console.error(`[Server] WebSocket错误 (${playerId}):`, err)
        })
    }

    handleMessage(playerId, ws, message) {
        switch (message.type) {
            case 'join_room':
                this.handleJoinRoom(playerId, ws, message)
                break
            case 'create_room':
                this.handleCreateRoom(playerId, ws, message)
                break
            case 'player_ready':
                this.handlePlayerReady(playerId, message.ready)
                break
            case 'player_update':
                this.handlePlayerUpdate(playerId, message.data)
                break
            case 'platform_trigger':
                this.handlePlatformTrigger(playerId, message.platformId)
                break
            case 'restart_game':
                this.handleRestartGame(playerId)
                break
        }
    }

    handleJoinRoom(playerId, ws, message) {
        let room
        if (message.roomId) {
            room = this.getRoom(message.roomId)
            if (!room) {
                this.send(ws, { type: 'error', message: '房间不存在' })
                return
            }
            if (room.state !== ROOM_STATE.WAITING) {
                this.send(ws, { type: 'error', message: '游戏已开始' })
                return
            }
        } else {
            room = this.findAvailableRoom()
        }

        if (!room.addPlayer(playerId, message.playerName)) {
            this.send(ws, { type: 'error', message: '房间已满' })
            return
        }

        this.playerRooms.set(playerId, room.id)
        
        this.send(ws, {
            type: 'joined_room',
            roomId: room.id,
            playerId: playerId
        })
        
        this.broadcastRoomState(room)
    }

    handleCreateRoom(playerId, ws, message) {
        const room = this.createRoom()
        room.addPlayer(playerId, message.playerName)
        this.playerRooms.set(playerId, room.id)
        
        this.send(ws, {
            type: 'joined_room',
            roomId: room.id,
            playerId: playerId
        })
        
        this.broadcastRoomState(room)
    }

    handlePlayerReady(playerId, ready) {
        const roomId = this.playerRooms.get(playerId)
        if (!roomId) return
        
        const room = this.getRoom(roomId)
        if (!room || room.state !== ROOM_STATE.WAITING) return
        
        room.setPlayerReady(playerId, ready)
        
        if (room.allPlayersReady()) {
            room.startCountdown(() => {
                room.startGame()
                // 发送游戏开始消息，包含所有初始平台
                this.broadcastGameStart(room)
                // 启动广播循环
                this.startBroadcastLoop(room)
            })
        }
        
        this.broadcastRoomState(room)
    }

    handlePlayerUpdate(playerId, data) {
        const roomId = this.playerRooms.get(playerId)
        if (!roomId) return
        
        const room = this.getRoom(roomId)
        if (!room || room.state !== ROOM_STATE.PLAYING) return
        
        room.handlePlayerUpdate(playerId, data)
    }

    handlePlatformTrigger(playerId, platformId) {
        const roomId = this.playerRooms.get(playerId)
        if (!roomId) return
        
        const room = this.getRoom(roomId)
        if (!room || room.state !== ROOM_STATE.PLAYING) return
        
        room.handlePlatformTrigger(platformId, playerId)
        
        // 广播平台触发事件给所有玩家
        this.broadcastToRoom(room, {
            type: 'platform_triggered',
            platformId: platformId,
            playerId: playerId
        })
    }

    handleRestartGame(playerId) {
        const roomId = this.playerRooms.get(playerId)
        if (!roomId) return
        
        const room = this.getRoom(roomId)
        if (!room || room.state !== ROOM_STATE.FINISHED) return
        
        room.state = ROOM_STATE.WAITING
        room.winner = null
        room.currentLevel = 1
        
        for (const player of room.players.values()) {
            player.ready = false
        }
        
        this.broadcastRoomState(room)
    }

    handleDisconnect(playerId) {
        console.log(`[Server] 玩家断开: ${playerId}`)
        
        const roomId = this.playerRooms.get(playerId)
        if (roomId) {
            const room = this.getRoom(roomId)
            if (room) {
                room.removePlayer(playerId)
                
                if (room.players.size === 0) {
                    this.removeRoom(roomId)
                } else {
                    if (room.state === ROOM_STATE.PLAYING) {
                        let aliveCount = 0
                        let lastAlive = null
                        for (const p of room.players.values()) {
                            if (p.alive) {
                                aliveCount++
                                lastAlive = p
                            }
                        }
                        if (aliveCount <= 1) {
                            room.endGame(lastAlive)
                        }
                    }
                    this.broadcastRoomState(room)
                }
            }
        }
        
        this.clients.delete(playerId)
        this.playerRooms.delete(playerId)
    }

    // 广播游戏开始消息，包含所有初始平台
    broadcastGameStart(room) {
        const state = room.getState()
        const message = {
            type: 'game_start',
            ...state
        }
        
        for (const playerId of room.players.keys()) {
            const ws = this.clients.get(playerId)
            if (ws && ws.readyState === WebSocket.OPEN) {
                this.send(ws, message)
            }
        }
    }

    startBroadcastLoop(room) {
        let tickCount = 0
        const calibrationTicks = Math.round(PLATFORM_SYNC_INTERVAL / (1000 / TICK_RATE))  // 每 100ms 校准一次
        
        const broadcastInterval = setInterval(() => {
            if (room.state !== ROOM_STATE.PLAYING) {
                clearInterval(broadcastInterval)
                this.broadcastRoomState(room)
                return
            }
            
            tickCount++
            
            // 检查是否有新平台需要发送
            const newPlatforms = room.getNewPlatforms()
            if (newPlatforms.length > 0) {
                this.broadcastToRoom(room, {
                    type: 'new_platforms',
                    serverTime: Date.now(),
                    platforms: newPlatforms
                })
            }
            
            // 定期发送平台校准数据
            if (tickCount >= calibrationTicks) {
                tickCount = 0
                this.broadcastToRoom(room, {
                    type: 'platform_calibration',
                    ...room.getPlatformCalibration()
                })
            }
            
            // 每次都发送玩家状态（用于同步其他玩家位置）
            this.broadcastPlayersState(room)
            
        }, 1000 / TICK_RATE)
    }

    // 广播玩家状态（不含平台）
    broadcastPlayersState(room) {
        const players = []
        for (const player of room.players.values()) {
            players.push({
                id: player.id,
                name: player.name,
                x: player.x,
                y: player.y,
                velocityX: player.velocityX,
                velocityY: player.velocityY,
                alive: player.alive,
                lives: player.lives,
                level: player.level
            })
        }
        
        this.broadcastToRoom(room, {
            type: 'players_state',
            serverTime: Date.now(),
            players: players
        })
    }

    broadcastRoomState(room) {
        const state = room.getState()
        const message = {
            type: 'game_state',
            ...state
        }
        
        for (const playerId of room.players.keys()) {
            const ws = this.clients.get(playerId)
            if (ws && ws.readyState === WebSocket.OPEN) {
                this.send(ws, message)
            }
        }
    }

    broadcastToRoom(room, message) {
        for (const playerId of room.players.keys()) {
            const ws = this.clients.get(playerId)
            if (ws && ws.readyState === WebSocket.OPEN) {
                this.send(ws, message)
            }
        }
    }

    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data))
        }
    }

    generatePlayerId() {
        return Math.random().toString(36).substring(2, 10)
    }
}

// HTTP 服务器
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, '..', req.url === '/' ? 'man-down-multiplayer.html' : req.url)
    
    const extname = path.extname(filePath)
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.gif': 'image/gif'
    }
    
    const contentType = contentTypes[extname] || 'application/octet-stream'
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404)
                res.end('Not Found')
            } else {
                res.writeHead(500)
                res.end('Server Error')
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType })
            res.end(content)
        }
    })
})

// WebSocket 服务器
const wss = new WebSocket.Server({ server })
const gameServer = new GameServer()

wss.on('connection', (ws) => {
    gameServer.handleConnection(ws)
})

// 启动服务器
server.listen(PORT, () => {
    console.log(`[Server] Man Down 100 多人游戏服务器启动 (优化版：批量下发+定期校准)`)
    console.log(`[Server] HTTP: http://localhost:${PORT}`)
    console.log(`[Server] WebSocket: ws://localhost:${PORT}`)
})
