export class SecuxKeyring extends EventEmitter {
    constructor(opts?: {});
    type: string;
    accounts: any[];
    hdk: any;
    page: number;
    perPage: number;
    unlockedAccount: number;
    paths: {};
    serialize(): Promise<{
        hdPath: any;
        accounts: any[];
        page: number;
        paths: {};
        perPage: number;
        unlockedAccount: number;
    }>;
    deserialize(opts?: {}): Promise<void>;
    hdPath: any;
    isUnlocked(): boolean;
    unlock(): Promise<any>;
    setAccountToUnlock(index: any): void;
    addAccounts(n?: number): Promise<any>;
    getFirstPage(): Promise<any>;
    getNextPage(): Promise<any>;
    getPreviousPage(): Promise<any>;
    __getPage(increment: any): Promise<any>;
    getAccounts(): Promise<any[]>;
    removeAccount(address: any): void;
    signTransaction(address: any, tx: any): Promise<any>;
    _signTransaction(address: any, chainId: any, tx: any, handleSigning: any): Promise<any>;
    signMessage(withAccount: any, data: any): Promise<any>;
    signPersonalMessage(withAccount: any, message: any): Promise<any>;
    signTypedData(): Promise<never>;
    exportAccount(): Promise<never>;
    forgetDevice(): void;
    _normalize(buf: any): string;
    _addressFromIndex(pathBase: any, i: any): string;
    _pathFromAddress(address: any): string;
}
export namespace SecuxKeyring {
    export { keyringType as type };
}
import { EventEmitter } from "events";
declare const keyringType: "Secux Hardware";
export {};
