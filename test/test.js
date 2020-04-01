const assert = require("assert")
const {Mutex, Ref, RwLock} = require("../dist")

describe("Mutex", () => {
	it("should initialize as idle", async () => {
		const mutex = new Mutex(1)
		assert.ok(mutex.isIdle())
	})

	it("should read the correct value", async () => {
		const mutex = new Mutex(new Ref(42))
		await mutex.run(async ref => {
			assert.strictEqual(ref.getValue(), 42)
		})
	})

	it("supports intermediate idle", async () => {
		const mutex = new Mutex(new Ref(42))
		await mutex.run(async ref => {
			ref.setValue(43)
		})
		await mutex.run(async ref => {
			assert.strictEqual(ref.getValue(), 43)
		})
	})

	it("should await after completion", async () => {
		const originalRef = new Ref(42)
		const mutex = new Mutex(originalRef)
		const promise = mutex.run(async ref => {
			await sleep() // breakpoint here
			ref.setValue(43)
		})
		// no breakpoint here
		assert.strictEqual(originalRef.getValue(), 42)
		await promise
		assert.strictEqual(originalRef.getValue(), 43)
	})

	it("should be ordered", async () => {
		const mutex = new Mutex(new Ref(42))
		mutex.run(async ref => {
			await sleep() // breakpoint here
			ref.setValue(43)
		})
		// no breakpoint before scheduling next
		await mutex.run(async ref => {
			assert.strictEqual(ref.getValue(), 43)
		})
	})

	it("should stack runnables", async () => {
		const mutex = new Mutex(new Ref(42))
		mutex.run(async ref => {
			await sleep() // breakpoint here
			assert.strictEqual(ref.getValue(), 42)
		})
		// no breakpoint until last mutex.run call
		mutex.run(async ref => {
			ref.setValue(43)
		})
		mutex.run(async ref => {
			assert.strictEqual(ref.getValue(), 43)
		})
		mutex.run(async ref => {
			ref.setValue(44)
		})
		await mutex.run(async ref => {
			assert.strictEqual(ref.getValue(), 44)
		})
	})
})

describe("RwLock", () => {
	it("should stack write locks", async () => {
		const lock = new RwLock(new Ref(42))
		lock.write(async ref => {
			await sleep() // breakpoint here
			assert.strictEqual(ref.getValue(), 42)
		})
		// no breakpoint until last mutex.run call
		lock.write(async ref => {
			ref.setValue(43)
		})
		lock.write(async ref => {
			assert.strictEqual(ref.getValue(), 43)
		})
		lock.write(async ref => {
			ref.setValue(44)
		})
		await lock.write(async ref => {
			assert.strictEqual(ref.getValue(), 44)
		})
	})

	it("should run read operations together", async () => {
		const lock = new RwLock(new Ref(42))
		let counter = 0
		lock.read(async ref => {
			await sleep(100)
			assert.strictEqual(ref.getValue(), 42)
			counter++
			assert.strictEqual(counter, 2)
		})
		await lock.read(async ref => {
			await sleep(50)
			assert.strictEqual(ref.getValue(), 42)
			counter++
			assert.strictEqual(counter, 1)
		})
	})

	it("should not await all peer reads to complete before resolving", async () => {
		const lock = new RwLock(new Ref(42))
		let counter = 0
		const p1 = lock.read(async ref => {
			assert.strictEqual(ref.getValue(), 42)
			counter++
			await sleep(100)
			counter++
			assert.strictEqual(counter, 3)
		})
		assert.strictEqual(counter, 1)
		const p2 = lock.read(async ref => {
			await sleep(50)
			assert.strictEqual(ref.getValue(), 42)
			counter++
			assert.strictEqual(counter, 2)
		})
		await p2
		assert.strictEqual(counter, 2)
		await p1
		assert.strictEqual(counter, 3)
	})

	it("should separate read after write", async () => {
		const lock = new RwLock(new Ref(42))
		let counter = 0
		const p1 = lock.read(async ref => {
			assert.strictEqual(ref.getValue(), 42)
			counter++
			await sleep(100)
			counter++
			assert.strictEqual(ref.getValue(), 42)
			assert.strictEqual(counter, 2)
		})
		const p2 = lock.write(async ref => {
			counter++
			assert.strictEqual(counter, 3)
			ref.setValue(24)
			await sleep(100)
			assert.strictEqual(counter, 3)
		})
		const p3 = lock.read(async ref => {
			await sleep(50)
			assert.strictEqual(ref.getValue(), 24)
			counter++
			assert.strictEqual(counter, 5)
		})
		const p4 = lock.read(async ref => {
			assert.strictEqual(ref.getValue(), 24)
			counter++
			assert.strictEqual(counter, 4)
		})
		await p4
		assert.strictEqual(counter, 4)
		await p3
		assert.strictEqual(counter, 5)
	})

	it("supports intermediate idle", async () => {
		const lock = new RwLock(null)
		let counter = 0
		await lock.read(async ref => {
			counter++
		})
		await sleep()
		await lock.read(async ref => {
			counter++
		})
		assert.strictEqual(counter, 2)
	})
})

function sleep(time) {
	return new Promise(resolve => {
		setTimeout(resolve, time)
	})
}
