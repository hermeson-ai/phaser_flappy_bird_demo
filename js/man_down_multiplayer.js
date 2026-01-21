/**
 * Man Down 100 - 多人游戏客户端
 * 优化版：客户端本地管理平台滚动，服务器定期校准
 */

// ========== 基础配置（与单人模式对齐）==========
const MP_BASE_GAME_WIDTH = 320
const MP_BASE_GAME_HEIGHT = 512
const MP_RESOLUTION_SCALE = 3

const mpScaleValue = (value) => Math.round(value * MP_RESOLUTION_SCALE)

const MP_GAME_WIDTH = mpScaleValue(MP_BASE_GAME_WIDTH)   // 960
const MP_GAME_HEIGHT = mpScaleValue(MP_BASE_GAME_HEIGHT) // 1536
const MP_MAX_LIVES = 5
const DEBUG_MODE = true

// 物理参数（与单人模式对齐）
const MP_GRAVITY = mpScaleValue(600)
const MP_PLAYER_MOVE_SPEED = mpScaleValue(220)
const MP_PLAYER_MAX_FALL_SPEED = mpScaleValue(600)
const MP_BOUNCE_VELOCITY = mpScaleValue(-320)
const MP_PLATFORM_SCROLL_SPEED = mpScaleValue(-60)

// 玩家尺寸
const MP_BASE_PLAYER_DISPLAY_SIZE = { width: 40, height: 70 }
const MP_BASE_PLAYER_BODY_SIZE = { width: 34, height: 62, bottomPadding: 4 }

// 平台类型
const MP_PLATFORM_TYPE = {
    NORMAL: 'normal',
    FRAGILE: 'fragile',
    BOUNCE: 'bounce',
    POISON: 'poison'
}

// 房间状态
const MP_ROOM_STATE = {
    WAITING: 'waiting',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    FINISHED: 'finished'
}

// 玩家颜色
const PLAYER_COLORS = [0x00ff00, 0x00ffff, 0xff00ff, 0xffff00]

/**
 * 多人游戏客户端类
 */
class MultiplayerClient {
    constructor() {
        this.ws = null
        this.playerId = null
        this.roomId = null
        this.playerName = null
        this.connected = false
        this.onStateUpdate = null
        this.onConnected = null
        this.onJoinedRoom = null
        this.onError = null
        this.onGameStart = null
        this.onNewPlatforms = null
        this.onPlatformCalibration = null
        this.onPlayersState = null
        this.onPlatformTriggered = null
    }

    connect(serverUrl) {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(serverUrl)
            
            this.ws.onopen = () => {
                console.log('[Client] 已连接到服务器')
                this.connected = true
            }
            
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data)
                this.handleMessage(message, resolve, reject)
            }
            
            this.ws.onclose = () => {
                console.log('[Client] 连接已关闭')
                this.connected = false
            }
            
            this.ws.onerror = (error) => {
                console.error('[Client] WebSocket错误:', error)
                reject(error)
            }
        })
    }

    handleMessage(message, resolveConnect, rejectConnect) {
        switch (message.type) {
            case 'connected':
                this.playerId = message.playerId
                console.log('[Client] 获得玩家ID:', this.playerId)
                if (this.onConnected) this.onConnected(this.playerId, message.gameConfig)
                if (resolveConnect) resolveConnect(this.playerId)
                break
                
            case 'joined_room':
                this.roomId = message.roomId
                console.log('[Client] 加入房间:', this.roomId)
                if (this.onJoinedRoom) this.onJoinedRoom(message)
                break
                
            case 'game_state':
                if (this.onStateUpdate) this.onStateUpdate(message)
                break
            
            case 'game_start':
                console.log('[Client] 游戏开始，收到初始平台:', message.platforms.length)
                if (this.onGameStart) this.onGameStart(message)
                break
            
            case 'new_platforms':
                if (this.onNewPlatforms) this.onNewPlatforms(message)
                break
            
            case 'platform_calibration':
                if (this.onPlatformCalibration) this.onPlatformCalibration(message)
                break
            
            case 'players_state':
                if (this.onPlayersState) this.onPlayersState(message)
                break
            
            case 'platform_triggered':
                if (this.onPlatformTriggered) this.onPlatformTriggered(message)
                break
                
            case 'error':
                console.error('[Client] 服务器错误:', message.message)
                if (this.onError) this.onError(message.message)
                break
        }
    }

    createRoom(playerName) {
        this.playerName = playerName
        this.send({ type: 'create_room', playerName })
    }

    joinRoom(roomId, playerName) {
        this.playerName = playerName
        this.send({ type: 'join_room', roomId, playerName })
    }

    quickMatch(playerName) {
        this.playerName = playerName
        this.send({ type: 'join_room', playerName })
    }

    setReady(ready) {
        this.send({ type: 'player_ready', ready })
    }

    // 上报玩家状态
    sendPlayerUpdate(data) {
        if (this.connected) {
            this.send({ type: 'player_update', data })
        }
    }

    // 上报平台触发事件
    sendPlatformTrigger(platformId) {
        if (this.connected) {
            this.send({ type: 'platform_trigger', platformId })
        }
    }

    requestRestart() {
        this.send({ type: 'restart_game' })
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close()
        }
    }
}

/**
 * 多人游戏主类 - 使用 Phaser 物理引擎
 */
class ManDownMultiplayer {
    constructor() {
        this.client = new MultiplayerClient()
        this.game = null
        this.scene = null
        
        // 游戏状态
        this.gameState = null
        this.localPlayer = null  // 本地玩家精灵（带物理）
        this.lives = MP_MAX_LIVES
        this.level = 1
        this.isDead = false
        
        // 游戏对象
        this.otherPlayers = new Map()  // 其他玩家（纯渲染）
        this.platforms = null  // Phaser 物理组
        this.platformMap = new Map()  // id -> platform sprite
        this.backgroundImage = null
        this.topBarrier = null
        
        // 平台滚动参数
        this.platformScrollSpeed = MP_PLATFORM_SCROLL_SPEED
        this.gameStartTime = 0  // 服务器游戏开始时间
        this.serverTimeOffset = 0  // 客户端与服务器时间差
        
        // UI 元素
        this.levelText = null
        this.livesText = null
        this.playersStatusText = null
        
        this.isReady = false
        this.assetsLoaded = false
        this.cursors = null
        
        // 上报频率控制
        this.lastUpdateTime = 0
        this.updateInterval = 50  // 50ms 上报一次
    }

    async init() {
        this.showConnectUI()
    }

    showConnectUI() {
        const container = document.getElementById('game-container')
        container.innerHTML = `
            <div class="lobby-screen">
                <h1>Man Down 100</h1>
                <h2>多人对战</h2>
                <div class="input-group">
                    <label>玩家昵称:</label>
                    <input type="text" id="player-name" placeholder="输入昵称" maxlength="12" value="玩家${Math.floor(Math.random() * 1000)}">
                </div>
                <div class="button-group">
                    <button id="btn-quick-match" class="btn-primary">快速匹配</button>
                    <button id="btn-create-room" class="btn-secondary">创建房间</button>
                </div>
                <div class="input-group">
                    <label>房间号:</label>
                    <input type="text" id="room-id" placeholder="输入房间号" maxlength="6">
                    <button id="btn-join-room" class="btn-secondary">加入房间</button>
                </div>
                <div id="status-message" class="status-message"></div>
            </div>
        `
        
        document.getElementById('btn-quick-match').onclick = () => this.quickMatch()
        document.getElementById('btn-create-room').onclick = () => this.createRoom()
        document.getElementById('btn-join-room').onclick = () => this.joinRoom()
    }

    async connectToServer() {
        // 支持配置独立的 WebSocket 服务器地址
        // 如果设置了 GAME_SERVER_URL，使用它；否则使用当前页面的 host
        let serverUrl
        if (window.GAME_SERVER_URL) {
            serverUrl = window.GAME_SERVER_URL
        } else {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
            const host = window.location.host || 'localhost:3000'
            serverUrl = `${protocol}//${host}`
        }
        
        this.showStatus('正在连接服务器...')
        
        try {
            await this.client.connect(serverUrl)
            this.setupClientCallbacks()
            return true
        } catch (error) {
            this.showStatus('连接服务器失败，请检查网络', true)
            return false
        }
    }

    setupClientCallbacks() {
        this.client.onJoinedRoom = (data) => {
            this.showRoomLobby(data.roomId)
        }
        
        this.client.onStateUpdate = (state) => {
            this.handleStateUpdate(state)
        }
        
        this.client.onGameStart = (state) => {
            this.handleGameStart(state)
        }
        
        this.client.onNewPlatforms = (data) => {
            this.handleNewPlatforms(data)
        }
        
        this.client.onPlatformCalibration = (data) => {
            this.handlePlatformCalibration(data)
        }
        
        this.client.onPlayersState = (data) => {
            this.handlePlayersState(data)
        }
        
        this.client.onPlatformTriggered = (data) => {
            this.handlePlatformTriggered(data)
        }
        
        this.client.onError = (message) => {
            this.showStatus(message, true)
        }
    }

    async quickMatch() {
        if (!await this.connectToServer()) return
        const playerName = document.getElementById('player-name').value.trim() || '匿名玩家'
        this.client.quickMatch(playerName)
        this.showStatus('正在匹配...')
    }

    async createRoom() {
        if (!await this.connectToServer()) return
        const playerName = document.getElementById('player-name').value.trim() || '匿名玩家'
        this.client.createRoom(playerName)
        this.showStatus('正在创建房间...')
    }

    async joinRoom() {
        const roomId = document.getElementById('room-id').value.trim().toUpperCase()
        if (!roomId) {
            this.showStatus('请输入房间号', true)
            return
        }
        if (!await this.connectToServer()) return
        const playerName = document.getElementById('player-name').value.trim() || '匿名玩家'
        this.client.joinRoom(roomId, playerName)
        this.showStatus('正在加入房间...')
    }

    showRoomLobby(roomId) {
        const container = document.getElementById('game-container')
        container.innerHTML = `
            <div class="room-lobby">
                <h2>房间: ${roomId}</h2>
                <p class="room-tip">分享房间号给好友一起游戏！</p>
                <div id="players-list" class="players-list"></div>
                <div id="room-status" class="room-status">等待玩家加入...</div>
                <div class="button-group">
                    <button id="btn-ready" class="btn-primary">准备</button>
                    <button id="btn-leave" class="btn-secondary">离开房间</button>
                </div>
            </div>
        `
        
        document.getElementById('btn-ready').onclick = () => this.toggleReady()
        document.getElementById('btn-leave').onclick = () => this.leaveRoom()
    }

    toggleReady() {
        this.isReady = !this.isReady
        this.client.setReady(this.isReady)
        
        const btn = document.getElementById('btn-ready')
        btn.textContent = this.isReady ? '取消准备' : '准备'
        btn.className = this.isReady ? 'btn-secondary' : 'btn-primary'
    }

    leaveRoom() {
        this.client.disconnect()
        this.showConnectUI()
    }

    handleStateUpdate(state) {
        this.gameState = state
        
        // 更新平台滚动速度
        if (state.platformScrollSpeed) {
            this.platformScrollSpeed = state.platformScrollSpeed
        }
        
        if (state.state === MP_ROOM_STATE.WAITING || state.state === MP_ROOM_STATE.COUNTDOWN) {
            if (this.game && this.assetsLoaded) {
                this.cleanupGameObjects()
            }
            this.updateLobbyUI(state)
        } else if (state.state === MP_ROOM_STATE.FINISHED) {
            this.showGameOver(state)
        }
    }

    // 处理游戏开始：初始化所有平台
    handleGameStart(state) {
        this.gameState = state
        this.gameStartTime = state.gameStartTime
        this.serverTimeOffset = Date.now() - state.serverTime
        
        if (!this.game) {
            this.startPhaserGame()
        }
        
        // 等待 Phaser 加载完成后初始化
        this.waitForAssetsAndInit(state)
    }

    waitForAssetsAndInit(state) {
        if (this.assetsLoaded) {
            this.initGameFromState(state)
        } else {
            setTimeout(() => this.waitForAssetsAndInit(state), 100)
        }
    }

    initGameFromState(state) {
        // 清理旧对象
        this.cleanupGameObjects()
        
        // 初始化所有平台
        for (const pData of state.platforms) {
            this.createPlatform(pData)
        }
        
        // 同步玩家
        this.syncPlayers(state.players)
        
        console.log('[Client] 游戏初始化完成，平台数:', this.platformMap.size)
    }

    // 处理新平台：服务器下发的新生成平台
    handleNewPlatforms(data) {
        if (!this.assetsLoaded) return
        
        for (const pData of data.platforms) {
            if (!this.platformMap.has(pData.id)) {
                this.createPlatform(pData)
            }
        }
    }

    // 处理平台校准：同步服务器的平台位置
    handlePlatformCalibration(data) {
        if (!this.assetsLoaded) return
        
        // 更新时间同步
        this.serverTimeOffset = Date.now() - data.serverTime
        
        // 校准平台位置
        for (const pCalib of data.platforms) {
            const platform = this.platformMap.get(pCalib.id)
            if (platform) {
                // 计算当前位置与服务器位置的差异
                const diff = Math.abs(platform.y - pCalib.y)
                if (diff > 10) {  // 只在差异大于 10 像素时校准
                    // 平滑校准，不要突然跳变
                    platform.y = Phaser.Math.Linear(platform.y, pCalib.y, 0.5)
                    platform.body.y = platform.y - platform.body.height / 2
                }
            }
        }
        
        // 移除服务器不再发送的平台
        const serverIds = new Set(data.platforms.map(p => p.id))
        for (const [id, platform] of this.platformMap) {
            if (!serverIds.has(id)) {
                platform.destroy()
                this.platformMap.delete(id)
            }
        }
    }

    // 处理玩家状态更新
    handlePlayersState(data) {
        if (!this.assetsLoaded) return
        
        // 更新时间同步
        this.serverTimeOffset = Date.now() - data.serverTime
        
        // 同步玩家（不含本地玩家的位置，只更新其他玩家）
        for (let i = 0; i < data.players.length; i++) {
            const pData = data.players[i]
            
            if (pData.id === this.client.playerId) {
                // 本地玩家：只同步 alive 状态
                if (!pData.alive && !this.isDead) {
                    this.isDead = true
                    if (this.localPlayer) {
                        this.localPlayer.setAlpha(0.3)
                    }
                }
            } else {
                // 其他玩家：更新位置
                this.syncOtherPlayer(pData, i)
            }
        }
        
        // 更新玩家状态列表
        const statusLines = data.players.map((p, i) => {
            const status = p.alive ? `♥${p.lives}` : '💀'
            const isLocal = p.id === this.client.playerId ? ' (你)' : ''
            return `${p.name}${isLocal}: ${status}`
        })
        if (this.playersStatusText) {
            this.playersStatusText.setText(statusLines.join('\n'))
        }
    }

    // 处理其他玩家触发平台
    handlePlatformTriggered(data) {
        if (!this.assetsLoaded) return
        if (data.playerId === this.client.playerId) return  // 忽略自己的触发
        
        const platform = this.platformMap.get(data.platformId)
        if (platform && !platform.getData('triggered')) {
            platform.setData('triggered', true)
            const platformType = platform.getData('type')
            
            if (platformType === MP_PLATFORM_TYPE.FRAGILE) {
                platform.setAlpha(0.5)
                this.scene.time.delayedCall(400, () => {
                    if (this.platformMap.has(data.platformId)) {
                        this.platformMap.get(data.platformId).destroy()
                        this.platformMap.delete(data.platformId)
                    }
                })
            }
        }
    }

    cleanupGameObjects() {
        // 清理其他玩家
        for (const [id, playerObj] of this.otherPlayers) {
            if (playerObj.nameTag) playerObj.nameTag.destroy()
            playerObj.destroy()
        }
        this.otherPlayers.clear()
        
        // 清理平台
        if (this.platforms) {
            this.platforms.clear(true, true)
        }
        this.platformMap.clear()
        
        // 清理本地玩家
        if (this.localPlayer) {
            if (this.localPlayer.nameTag) this.localPlayer.nameTag.destroy()
            this.localPlayer.destroy()
            this.localPlayer = null
        }
        
        this.isDead = false
        this.lives = MP_MAX_LIVES
        this.level = 1
    }

    updateLobbyUI(state) {
        const playersList = document.getElementById('players-list')
        const roomStatus = document.getElementById('room-status')
        
        if (playersList) {
            playersList.innerHTML = state.players.map((p, i) => `
                <div class="player-item ${p.id === this.client.playerId ? 'local-player' : ''}">
                    <span class="player-color" style="background-color: ${this.getColorCSS(PLAYER_COLORS[i % PLAYER_COLORS.length])}"></span>
                    <span class="player-name">${p.name}</span>
                    <span class="player-status ${p.ready ? 'ready' : ''}">${p.ready ? '✓ 已准备' : '等待中'}</span>
                </div>
            `).join('')
        }
        
        if (roomStatus) {
            if (state.state === MP_ROOM_STATE.COUNTDOWN) {
                roomStatus.innerHTML = `<span class="countdown">游戏开始倒计时: ${state.countdown}</span>`
            } else if (!DEBUG_MODE && state.players.length < 2) {
                roomStatus.textContent = '等待更多玩家加入... (至少需要2人)'
            } else {
                const readyCount = state.players.filter(p => p.ready).length
                roomStatus.textContent = `${readyCount}/${state.players.length} 玩家已准备`
            }
        }
    }

    startPhaserGame() {
        const container = document.getElementById('game-container')
        container.innerHTML = '<div id="phaser-game"></div>'
        
        const config = {
            type: Phaser.AUTO,
            width: MP_GAME_WIDTH,
            height: MP_GAME_HEIGHT,
            parent: 'phaser-game',
            backgroundColor: '#000000',
            physics: {
                default: 'arcade',
                arcade: {
                    gravity: { y: MP_GRAVITY },
                    debug: false
                }
            },
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            },
            scene: {
                preload: () => this.preload(),
                create: () => this.create(),
                update: (time, delta) => this.update(time, delta)
            }
        }
        
        this.game = new Phaser.Game(config)
    }

    preload() {
        this.scene = this.game.scene.scenes[0]
        
        this.scene.load.image('background', 'assets/bg_night1.png')
        this.scene.load.image('platform', 'assets/platform.png')
        this.scene.load.image('top', 'assets/top.png')
        this.scene.load.spritesheet('player_walk', 'assets/avatar_walk_sprite.png', {
            frameWidth: 198,
            frameHeight: 341
        })
        this.scene.load.spritesheet('player_jump', 'assets/avatar_jump3_sprite.png', {
            frameWidth: 198,
            frameHeight: 341
        })
    }

    create() {
        const { width, height } = this.scene.scale
        
        // 背景
        this.backgroundImage = this.scene.add.image(width / 2, height / 2, 'background')
        const bgScaleX = width / this.backgroundImage.width
        const bgScaleY = height / this.backgroundImage.height
        this.backgroundImage.setScale(bgScaleX, bgScaleY)
        this.backgroundImage.setDepth(-1)
        
        // 顶部锯齿
        const barrierHeight = mpScaleValue(15)
        this.topBarrier = this.scene.add.image(width / 2, 0, 'top')
        this.topBarrier.setOrigin(0.5, 0)
        this.topBarrier.setDisplaySize(width, barrierHeight)
        this.topBarrier.setDepth(5)
        this.topBarrier.setTint(0x777777)
        
        // 创建平台物理组
        this.platforms = this.scene.physics.add.staticGroup()
        
        // 动画
        this.scene.anims.create({
            key: 'mp-walk',
            frames: this.scene.anims.generateFrameNumbers('player_walk', { start: 0, end: 34 }),
            frameRate: 40,
            repeat: -1
        })
        this.scene.anims.create({
            key: 'mp-jump',
            frames: this.scene.anims.generateFrameNumbers('player_jump', { start: 0, end: 34 }),
            frameRate: 30,
            repeat: 0
        })
        this.scene.anims.create({
            key: 'mp-idle',
            frames: [{ key: 'player_jump', frame: 1 }],
            frameRate: 1
        })
        
        // HUD
        this.levelText = this.scene.add.text(mpScaleValue(10), mpScaleValue(10), '', {
            fontFamily: 'Georgia, serif',
            fontSize: `${mpScaleValue(12)}px`,
            fill: '#ffffff'
        }).setDepth(20)
        
        this.livesText = this.scene.add.text(mpScaleValue(10), mpScaleValue(25), '', {
            fontFamily: 'Georgia, serif',
            fontSize: `${mpScaleValue(10)}px`,
            fill: '#ffffff'
        }).setDepth(20)
        
        this.playersStatusText = this.scene.add.text(width - mpScaleValue(10), mpScaleValue(10), '', {
            fontFamily: 'Georgia, serif',
            fontSize: `${mpScaleValue(8)}px`,
            fill: '#ffffff',
            align: 'right'
        }).setOrigin(1, 0).setDepth(20)
        
        // 输入控制
        this.cursors = this.scene.input.keyboard.createCursorKeys()
        
        // 触摸控制
        this.touchInput = { left: false, right: false }
        this.scene.input.on('pointerdown', (pointer) => {
            if (pointer.x < width / 2) {
                this.touchInput.left = true
            } else {
                this.touchInput.right = true
            }
        })
        this.scene.input.on('pointermove', (pointer) => {
            if (pointer.isDown) {
                this.touchInput.left = pointer.x < width / 2
                this.touchInput.right = pointer.x >= width / 2
            }
        })
        this.scene.input.on('pointerup', () => {
            this.touchInput.left = false
            this.touchInput.right = false
        })
        
        this.assetsLoaded = true
    }

    // 创建单个平台
    createPlatform(pData) {
        const platform = this.platforms.create(pData.x, pData.y, 'platform')
        platform.setScale(pData.width / platform.width, 0.32)
        platform.setDepth(2)
        platform.refreshBody()
        
        // 存储平台数据
        platform.setData('id', pData.id)
        platform.setData('type', pData.type)
        platform.setData('triggered', pData.triggered)
        platform.setData('initialY', pData.initialY)  // 存储初始 y 位置
        platform.setData('level', Math.floor(pData.id / 2) + 1)
        
        // 设置颜色
        switch (pData.type) {
            case MP_PLATFORM_TYPE.FRAGILE:
                platform.setTint(0xff6666)
                break
            case MP_PLATFORM_TYPE.BOUNCE:
                platform.setTint(0xffff00)
                break
            case MP_PLATFORM_TYPE.POISON:
                platform.setTint(0x111111)
                break
        }
        
        this.platformMap.set(pData.id, platform)
        return platform
    }

    update(time, delta) {
        if (!this.gameState || this.gameState.state !== MP_ROOM_STATE.PLAYING) return
        if (!this.assetsLoaded || !this.localPlayer) return
        
        // 本地更新平台位置（基于恒定滚动速度）
        this.updatePlatformPositions(delta)
        
        // 本地玩家物理更新
        if (!this.isDead) {
            this.updateLocalPlayer(delta)
            this.checkDeathConditions()
        }
        
        // 定期上报状态给服务器
        if (time - this.lastUpdateTime > this.updateInterval) {
            this.sendPlayerState()
            this.lastUpdateTime = time
        }
        
        // 更新 HUD
        this.levelText.setText(`层数: ${this.level}`)
        this.livesText.setText(`生命: ${this.lives}`)
    }

    // 本地更新平台位置（恒定速度滚动）
    updatePlatformPositions(delta) {
        const moveAmount = this.platformScrollSpeed * (delta / 1000)
        
        // 移动所有平台
        for (const [id, platform] of this.platformMap) {
            platform.y += moveAmount
            platform.body.y = platform.y - platform.body.height / 2
            
            // 移除超出屏幕的平台
            if (platform.y < -100) {
                platform.destroy()
                this.platformMap.delete(id)
            }
        }
        
        // 如果本地玩家站在平台上，跟随平台移动
        if (this.localPlayer && this.localPlayer.body.touching.down && !this.isDead) {
            this.localPlayer.y += moveAmount
        }
    }

    updateLocalPlayer(delta) {
        const player = this.localPlayer
        if (!player || !player.body) return
        
        // 左右移动
        const moveLeft = this.cursors.left.isDown || this.touchInput.left
        const moveRight = this.cursors.right.isDown || this.touchInput.right
        
        if (moveLeft && !moveRight) {
            player.body.setVelocityX(-MP_PLAYER_MOVE_SPEED)
            player.setFlipX(false)
            player.anims.play('mp-walk', true)
        } else if (moveRight && !moveLeft) {
            player.body.setVelocityX(MP_PLAYER_MOVE_SPEED)
            player.setFlipX(true)
            player.anims.play('mp-walk', true)
        } else {
            player.body.setVelocityX(player.body.velocity.x * 0.8)
            if (Math.abs(player.body.velocity.x) < 10) {
                player.body.setVelocityX(0)
            }
            player.anims.play('mp-idle', true)
        }
        
        // 限制最大下落速度
        if (player.body.velocity.y > MP_PLAYER_MAX_FALL_SPEED) {
            player.body.setVelocityY(MP_PLAYER_MAX_FALL_SPEED)
        }
        
        // 左右边界
        if (player.x < 0) player.x = 0
        if (player.x > MP_GAME_WIDTH) player.x = MP_GAME_WIDTH
        
        // 更新名字标签位置
        if (player.nameTag) {
            player.nameTag.x = player.x
            player.nameTag.y = player.y - player.nameTagOffset
        }
    }

    checkDeathConditions() {
        if (!this.localPlayer || this.isDead) return
        
        const player = this.localPlayer
        
        // 顶部死亡
        if (player.y < mpScaleValue(-5)) {
            this.onPlayerDeath('被顶出屏幕')
        }
        // 底部死亡
        else if (player.y > MP_GAME_HEIGHT + mpScaleValue(50)) {
            this.onPlayerDeath('掉出屏幕')
        }
        // HP 归零
        else if (this.lives <= 0) {
            this.onPlayerDeath('HP归零')
        }
    }

    onPlayerDeath(reason) {
        this.isDead = true
        console.log('[Client] 玩家死亡:', reason)
        
        if (this.localPlayer) {
            this.localPlayer.setAlpha(0.3)
            this.localPlayer.body.setVelocity(0, 0)
            this.localPlayer.body.allowGravity = false
        }
        
        // 通知服务器
        this.client.sendPlayerUpdate({
            x: this.localPlayer.x,
            y: this.localPlayer.y,
            velocityX: 0,
            velocityY: 0,
            lives: this.lives,
            level: this.level,
            died: true,
            deathReason: reason
        })
    }

    sendPlayerState() {
        if (!this.localPlayer || this.isDead) return
        
        this.client.sendPlayerUpdate({
            x: this.localPlayer.x,
            y: this.localPlayer.y,
            velocityX: this.localPlayer.body.velocity.x,
            velocityY: this.localPlayer.body.velocity.y,
            lives: this.lives,
            level: this.level
        })
    }

    // 平台碰撞回调
    onPlatformCollide(player, platform) {
        if (this.isDead) return
        if (!player.body.touching.down || !platform.body.touching.up) return
        
        const platformId = platform.getData('id')
        const platformType = platform.getData('type')
        const triggered = platform.getData('triggered')
        
        // 更新层数
        const platformLevel = platform.getData('level')
        if (platformLevel && platformLevel > this.level) {
            this.level = platformLevel
        }
        
        // 处理不同类型的平台
        switch (platformType) {
            case MP_PLATFORM_TYPE.BOUNCE:
                player.body.setVelocityY(MP_BOUNCE_VELOCITY)
                break
                
            case MP_PLATFORM_TYPE.POISON:
                if (!triggered) {
                    platform.setData('triggered', true)
                    this.lives--
                    this.client.sendPlatformTrigger(platformId)
                }
                break
                
            case MP_PLATFORM_TYPE.FRAGILE:
                if (!triggered) {
                    platform.setData('triggered', true)
                    platform.setAlpha(0.5)
                    this.client.sendPlatformTrigger(platformId)
                    // 本地延迟销毁
                    this.scene.time.delayedCall(400, () => {
                        if (this.platformMap.has(platformId)) {
                            this.platformMap.get(platformId).destroy()
                            this.platformMap.delete(platformId)
                        }
                    })
                }
                break
        }
    }

    syncPlayers(playersData) {
        const existingIds = new Set()
        
        for (let i = 0; i < playersData.length; i++) {
            const pData = playersData[i]
            existingIds.add(pData.id)
            
            if (pData.id === this.client.playerId) {
                // 本地玩家
                if (!this.localPlayer) {
                    this.createLocalPlayer(pData, i)
                }
                // 同步服务器的 alive 状态
                if (!pData.alive && !this.isDead) {
                    this.isDead = true
                    this.localPlayer.setAlpha(0.3)
                }
            } else {
                // 其他玩家（纯渲染，无物理）
                this.syncOtherPlayer(pData, i)
            }
        }
        
        // 移除不存在的其他玩家
        for (const [id, playerObj] of this.otherPlayers) {
            if (!existingIds.has(id)) {
                if (playerObj.nameTag) playerObj.nameTag.destroy()
                playerObj.destroy()
                this.otherPlayers.delete(id)
            }
        }
    }

    createLocalPlayer(pData, index) {
        const displayWidth = mpScaleValue(MP_BASE_PLAYER_DISPLAY_SIZE.width)
        const displayHeight = mpScaleValue(MP_BASE_PLAYER_DISPLAY_SIZE.height)
        const bodyWidth = mpScaleValue(MP_BASE_PLAYER_BODY_SIZE.width)
        const bodyHeight = mpScaleValue(MP_BASE_PLAYER_BODY_SIZE.height)
        
        // 创建带物理的精灵
        this.localPlayer = this.scene.physics.add.sprite(pData.x, pData.y, 'player_walk')
        this.localPlayer.setDisplaySize(displayWidth, displayHeight)
        this.localPlayer.setDepth(10)
        this.localPlayer.setTint(PLAYER_COLORS[index % PLAYER_COLORS.length])
        
        // 设置物理体
        this.localPlayer.body.setSize(bodyWidth, bodyHeight)
        this.localPlayer.body.setOffset(
            (this.localPlayer.width - bodyWidth) / 2,
            this.localPlayer.height - bodyHeight - mpScaleValue(MP_BASE_PLAYER_BODY_SIZE.bottomPadding)
        )
        this.localPlayer.setCollideWorldBounds(false)
        
        // 添加名字标签
        const nameTagOffset = displayHeight / 2 + mpScaleValue(5)
        const nameTag = this.scene.add.text(pData.x, pData.y - nameTagOffset, pData.name, {
            fontFamily: 'Arial',
            fontSize: `${mpScaleValue(7)}px`,
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: mpScaleValue(1)
        }).setOrigin(0.5).setDepth(11)
        
        this.localPlayer.nameTag = nameTag
        this.localPlayer.nameTagOffset = nameTagOffset
        
        // 设置与平台的碰撞
        this.scene.physics.add.collider(
            this.localPlayer, 
            this.platforms, 
            (player, platform) => this.onPlatformCollide(player, platform),
            null,
            this
        )
        
        // 同步初始状态
        this.lives = pData.lives
        this.level = pData.level
        this.isDead = !pData.alive
        
        console.log('[Client] 创建本地玩家:', pData.name)
    }

    syncOtherPlayer(pData, index) {
        let playerObj = this.otherPlayers.get(pData.id)
        
        if (!playerObj) {
            // 创建其他玩家（纯渲染）
            playerObj = this.scene.add.sprite(pData.x, pData.y, 'player_walk')
            const displayWidth = mpScaleValue(MP_BASE_PLAYER_DISPLAY_SIZE.width)
            const displayHeight = mpScaleValue(MP_BASE_PLAYER_DISPLAY_SIZE.height)
            playerObj.setDisplaySize(displayWidth, displayHeight)
            playerObj.setDepth(9)
            playerObj.setTint(PLAYER_COLORS[index % PLAYER_COLORS.length])
            
            // 名字标签
            const nameTagOffset = displayHeight / 2 + mpScaleValue(5)
            const nameTag = this.scene.add.text(pData.x, pData.y - nameTagOffset, pData.name, {
                fontFamily: 'Arial',
                fontSize: `${mpScaleValue(7)}px`,
                fill: '#ffffff',
                stroke: '#000000',
                strokeThickness: mpScaleValue(1)
            }).setOrigin(0.5).setDepth(11)
            
            playerObj.nameTag = nameTag
            playerObj.nameTagOffset = nameTagOffset
            this.otherPlayers.set(pData.id, playerObj)
        }
        
        // 平滑插值位置
        const lerpFactor = 0.3
        playerObj.x = Phaser.Math.Linear(playerObj.x, pData.x, lerpFactor)
        playerObj.y = Phaser.Math.Linear(playerObj.y, pData.y, lerpFactor)
        
        // 更新名字标签位置
        if (playerObj.nameTag) {
            playerObj.nameTag.x = playerObj.x
            playerObj.nameTag.y = playerObj.y - playerObj.nameTagOffset
        }
        
        // 更新动画和透明度
        if (pData.alive) {
            playerObj.setAlpha(1)
            if (Math.abs(pData.velocityX) > 10) {
                playerObj.anims.play('mp-walk', true)
                playerObj.setFlipX(pData.velocityX > 0)
            } else {
                playerObj.anims.play('mp-idle', true)
            }
        } else {
            playerObj.setAlpha(0.3)
            playerObj.anims.stop()
        }
    }

    showGameOver(state) {
        if (!this.scene) return
        
        const { width, height } = this.scene.scale
        
        const overlay = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7)
        overlay.setDepth(30)
        
        let resultText = '游戏结束!'
        if (state.winner) {
            if (state.winner.id === this.client.playerId) {
                resultText = '🎉 你赢了! 🎉'
            } else {
                resultText = `${state.winner.name} 获胜!`
            }
        } else {
            resultText = '平局!'
        }
        
        const titleText = this.scene.add.text(width / 2, height / 2 - mpScaleValue(50), resultText, {
            fontFamily: 'Georgia, serif',
            fontSize: `${mpScaleValue(24)}px`,
            fill: '#ffffff'
        }).setOrigin(0.5).setDepth(31)
        
        const sortedPlayers = [...state.players].sort((a, b) => b.level - a.level)
        const rankText = sortedPlayers.map((p, i) => 
            `${i + 1}. ${p.name}: 第${p.level}层`
        ).join('\n')
        
        const rankingText = this.scene.add.text(width / 2, height / 2, rankText, {
            fontFamily: 'Georgia, serif',
            fontSize: `${mpScaleValue(12)}px`,
            fill: '#ffffff',
            align: 'center'
        }).setOrigin(0.5).setDepth(31)
        
        const restartBtn = this.scene.add.text(width / 2 - mpScaleValue(50), height / 2 + mpScaleValue(65), '再来一局', {
            fontFamily: 'Georgia, serif',
            fontSize: `${mpScaleValue(14)}px`,
            fill: '#00ff00',
            backgroundColor: '#333333',
            padding: { x: mpScaleValue(7), y: mpScaleValue(3) }
        }).setOrigin(0.5).setDepth(31).setInteractive()
        
        const quitBtn = this.scene.add.text(width / 2 + mpScaleValue(50), height / 2 + mpScaleValue(65), '退出', {
            fontFamily: 'Georgia, serif',
            fontSize: `${mpScaleValue(14)}px`,
            fill: '#ff6666',
            backgroundColor: '#333333',
            padding: { x: mpScaleValue(7), y: mpScaleValue(3) }
        }).setOrigin(0.5).setDepth(31).setInteractive()
        
        restartBtn.on('pointerdown', () => {
            this.client.requestRestart()
            overlay.destroy()
            titleText.destroy()
            rankingText.destroy()
            restartBtn.destroy()
            quitBtn.destroy()
        })
        
        quitBtn.on('pointerdown', () => {
            this.cleanup()
            this.showConnectUI()
        })
    }

    cleanup() {
        if (this.game) {
            this.game.destroy(true)
            this.game = null
        }
        this.scene = null
        this.localPlayer = null
        this.otherPlayers.clear()
        this.platformMap.clear()
        this.platforms = null
        this.client.disconnect()
        this.isReady = false
        this.assetsLoaded = false
        this.isDead = false
        this.lives = MP_MAX_LIVES
        this.level = 1
    }

    showStatus(message, isError = false) {
        const statusEl = document.getElementById('status-message')
        if (statusEl) {
            statusEl.textContent = message
            statusEl.className = `status-message ${isError ? 'error' : ''}`
        }
    }

    getColorCSS(color) {
        return '#' + color.toString(16).padStart(6, '0')
    }
}

// 启动多人游戏
document.addEventListener('DOMContentLoaded', () => {
    const game = new ManDownMultiplayer()
    game.init()
})
