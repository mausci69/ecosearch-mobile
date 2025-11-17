import time

def main():
    print("EcoSearch worker starting...")
    while True:
        print("Worker heartbeat")
        time.sleep(10)


if __name__ == "__main__":
    main()

