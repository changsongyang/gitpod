/**
 * Copyright (c) 2021 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License-AGPL.txt in the project root for license information.
 */

import { useEffect, useState } from "react";
import ContextMenu, { ContextMenuEntry } from "../components/ContextMenu";
import { SettingsPage } from "./SettingsPage";
import { getGitpodService } from "../service/service";
import ThreeDots from '../icons/ThreeDots.svg';
import Modal from "../components/Modal";
import { TeamSubscription, TeamSubscriptionSlotResolved } from "@gitpod/gitpod-protocol/lib/team-subscription-protocol";
import { Currency, Plan, Plans } from "@gitpod/gitpod-protocol/lib/plans";
import { ChargebeeClient } from "../chargebee/chargebee-client";
import { exclamation } from "../images";
import { ErrorCodes } from "@gitpod/gitpod-protocol/lib/messaging/error";
import { poll, PollOptions } from "../utils";

export default function Teams() {

    return (<div>
        <SettingsPage title='Teams' subtitle='View and and manage subscriptions for your team with one centralized billing.'>
            <AllTeams />
        </SettingsPage>
    </div>);
}

interface Slot extends TeamSubscriptionSlotResolved {
    loading?: boolean;
    errorMsg?: string;
}

function slotsToSlotMap(slots: TeamSubscriptionSlotResolved[]) {
    const result = new Map<string, Slot>();
    slots.map(s => {
        // TODO only clear loading state for those which got updated
        result.set(s.id, s);
    });
    return result;
}

function AllTeams() {

    const [chargebeeClient, setChargebeeClient] = useState<ChargebeeClient>();

    const [slots, setSlots] = useState<Map<string, Slot>>(new Map());
    const [showPaymentUI, setShowPaymentUI] = useState<boolean>(false);
    // const [isChargebeeCustomer, setIsChargebeeCustomer] = useState<boolean>(false);
    const [teamSubscriptions, setTeamSubscriptions] = useState<TeamSubscription[]>([]);

    // const [showLoadingAnimation, setShowLoadingAnimation] = useState<boolean>(false);
    // const [loadingTookLongerThanExpected, setLoadingTookLongerThanExpected] = useState<boolean>(false);

    const [createTeamModal, setCreateTeamModal] = useState<{ client: ChargebeeClient, activeSubs: TeamSubscription[] } | undefined>(undefined);

    useEffect(() => {
        queryState();
    }, []);

    const queryState = async () => {
        const [slots, showPaymentUI, teamSubscriptions] = await Promise.all([
            getGitpodService().server.tsGetSlots(),
            getGitpodService().server.getShowPaymentUI(),
            // getGitpodService().server.isChargebeeCustomer(),
            getGitpodService().server.tsGet()
        ]);

        setSlots(slotsToSlotMap(slots));
        setShowPaymentUI(showPaymentUI);
        // setIsChargebeeCustomer(isChargebeeCustomer);
        setTeamSubscriptions(teamSubscriptions);

        if (showPaymentUI) {
            const chargebeeClient = await ChargebeeClient.new(getGitpodService().server);
            setChargebeeClient(chargebeeClient);
        }
    }

    const now = new Date().toISOString();
    const activeSubs = (teamSubscriptions || []).filter(ts => TeamSubscription.isActive(ts, now));

    if (!showPaymentUI || !chargebeeClient) {
        return (<div></div>);
    }

    const showCreateTeamModal = () => {
        setCreateTeamModal({ client: chargebeeClient, activeSubs })
    }

    const onBuy = (plan: Plan, quantity: number) => {
        inputHandler(undefined).buySlots(plan, quantity);
        setCreateTeamModal(undefined);
    }

    const inputHandler = (ts: TeamSubscription | undefined) => {
        return {
            buySlots: (plan: Plan, quantity: number) => {
                if (ts) {
                    // Buy new slots for existing subscription
                    if (ts.planId !== plan.chargebeeId) {
                        console.log("Plan IDs do not match!");
                        return;
                    }
                    // this.openModal(); // todo: progress reporting
                    getGitpodService().server.tsAddSlots(ts.id, quantity)
                        .then(() => pollForAdditionalSlotsBought(ts))
                        .catch((err) => {
                            // this.closeModal();  // todo: progress reporting
                            if (err.code === ErrorCodes.PAYMENT_ERROR) {
                                alert(`Payment error: ${err.message}`);
                            }
                        });
                } else {
                    // Buy new subscription + initial slots
                    // this.openModal(); // todo: progress reporting
                    let successful = false;
                    chargebeeClient.checkout((server) => server.checkout(plan.chargebeeId, quantity), {
                        success: () => {
                            successful = true;
                            pollForPlanPurchased(plan);
                        },
                        close: () => {
                            if (!successful) {
                                // Close gets triggered after success, too: Only close if necessary
                                // this.closeModal(); // todo: progress reporting
                            }
                        }
                    });
                }
            }
        };
    };
    const pollForPlanPurchased = (plan: Plan) => {
        const opts: PollOptions<TeamSubscription[]> = {
            backoffFactor: 1.2,
            warningInSeconds: 40,
            retryUntilSeconds: 120,
            success: async (result) => {
                const slotsResolved = await getGitpodService().server.tsGetSlots();
                // showLoadingAnimation: false, // todo progress
                // loadingTookLongerThanExpected: false // todo progress
                setSlots(slotsToSlotMap(slotsResolved))
                setTeamSubscriptions(result || [])
            },
            warn: () => undefined, // this.openModal(true), // todo progress
            stop: () => undefined // this.closeModal() // todo progress
        };
        poll<TeamSubscription[]>(1, async () => {
            const now = new Date().toISOString();
            const teamSubscriptions = await getGitpodService().server.tsGet();
            // Has active subscription with given plan?
            if (teamSubscriptions.some(t => TeamSubscription.isActive(t, now) && t.planId === plan.chargebeeId)) {
                return { done: true, result: teamSubscriptions };
            } else {
                return { done: false };
            }
        }, opts);
    }
    const pollForAdditionalSlotsBought = (ts: TeamSubscription) => {
        const opts: PollOptions<TeamSubscriptionSlotResolved[]> = {
            backoffFactor: 1.2,
            warningInSeconds: 40,
            retryUntilSeconds: 120,
            success: (result) => {
                setSlots(slotsToSlotMap(result!));
                // showLoadingAnimation: false, // todo progress
                // loadingTookLongerThanExpected: false // todo progress
            },
            stop: () => undefined // this.closeModal() // todo progress
        };
        poll<TeamSubscriptionSlotResolved[]>(1, async () => {
            const freshSlots = await getGitpodService().server.tsGetSlots();
            if (freshSlots.length > slots.size) {
                return { done: true, result: freshSlots };
            }
            return { done: false };
        }, opts);
    }

    const getPlan = (sub: TeamSubscription) => {
        return Plans.getAvailableTeamPlans().filter(p => p.chargebeeId === sub.planId)[0];
    }

    const subscriptionMenu = (sub: TeamSubscription) => {
        const result: ContextMenuEntry[] = [];
        result.push({
            title: 'Manage Members',
            onClick: () => manageMemebers(sub)
        })
        result.push({
            title: 'Add Members',
            onClick: () => addMembers(sub)
        })
        result.push({
            title: 'Invite Members',
            onClick: () => inviteMembers(sub)
        })
        return result;
    };

    const manageMemebers = (sub: TeamSubscription) => { }
    const addMembers = (sub: TeamSubscription) => { }
    const inviteMembers = (sub: TeamSubscription) => { }


    console.log(`activeSubs: ${JSON.stringify(activeSubs)}`)

    const formatDate = (date: string) => {
        try {
            return new Date(Date.parse(date)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (error) {
            return ""
        }
    }

    return (<div>


        <h3 className="flex-grow self-center">All Teams</h3>
        <h2>Manage teams and team members.</h2>

        {createTeamModal && (
            <NewTeamModal onClose={() => setCreateTeamModal(undefined)} onBuy={onBuy} {...createTeamModal} />
        )}

        {activeSubs && activeSubs.length === 0 && (
            <div className="w-full flex h-80 mt-2 rounded-xl bg-gray-100">
                <div className="m-auto text-center">
                    <h3 className="self-center text-gray-500 mb-4">No Active Teams</h3>
                    <div className="text-gray-500 mb-6">Get started by creating a team<br /> and adding team members. Learn more</div>
                    <button className="self-center" onClick={() => showCreateTeamModal()}>Create Team</button>
                </div>
            </div>
        )}

        {activeSubs && activeSubs.length > 0 && (
            <div className="flex flex-col pt-6 space-y-2">
                {activeSubs.map((sub, index) => (
                    <div key={"team-sub-" + sub.id} className="flex-grow flex flex-row hover:bg-gray-100 rounded-xl h-16 w-full">
                    <div className="px-4 self-center w-1/12">
                        <div className={"rounded-full w-3 h-3 text-sm align-middle bg-green-500"}>
                            &nbsp;
                        </div>
                    </div>
                    <div className="p-0 my-auto flex flex-col w-3/12">
                        <span className="my-auto font-medium truncate overflow-ellipsis">{getPlan(sub)?.name}</span>
                        <span className="text-sm my-auto text-gray-400 truncate overflow-ellipsis">Purchased on {formatDate(sub?.startDate)}</span>
                    </div>
                    <div className="p-0 my-auto flex flex-col w-2/12">
                        <span className="my-auto truncate text-gray-500 overflow-ellipsis">{sub.quantity || "–"}</span>
                        <span className="text-sm my-auto text-gray-400">Members</span>
                    </div>
                    <div className="p-0 my-auto flex flex-col w-5/12">
                        <span className="my-auto truncate text-gray-500 overflow-ellipsis">{"–"}</span>
                        <span className="text-sm my-auto text-gray-400">Next Biling Cycle</span>
                    </div>
                    <div className="my-auto flex w-1/12 pl-8">
                        <div className="self-center hover:bg-gray-200 rounded-md cursor-pointer w-8">
                            <ContextMenu menuEntries={subscriptionMenu(sub)}>
                                <img className="w-8 h-8 p-1" src={ThreeDots} alt="Actions" />
                            </ContextMenu>
                        </div>
                    </div>
                </div>
                ))}
            </div>
        )}


    </div>);
}

function NewTeamModal(props: {
    client: ChargebeeClient,
    activeSubs: TeamSubscription[],
    onBuy: (plan: Plan, quantity: number) => void,
    onClose: () => void,
}) {

    const types = ['professional', 'professional-new', 'student']

    const [type, setType] = useState<string>(types[0]);
    const [quantity, setQuantity] = useState<number>(5);

    const [expectedPrice, setExpectedPrice] = useState<string>("");

    useEffect(() => {
        const plan = getPlan(type);
        const expectedPrice = quantity * plan.pricePerMonth;
        setExpectedPrice(`${expectedPrice}${Currency.getSymbol(plan.currency)}`);
    }, [type, quantity])

    const getPlan = (type: string) => {
        return Plans.getAvailableTeamPlans().filter(p => p.type === type)[0];
    }

    const teamTypeLabel = (type: string) => {
        return getPlan(type)?.name;
    }

    return (<Modal visible={true} onClose={props.onClose}>
        <h3 className="pb-2">New Team</h3>
        <div className="border-t border-b border-gray-200 mt-2 -mx-6 px-6 py-4 space-y-2">
            <p className="pb-4 text-gray-500 text-base">Create a team and add team members.</p>

            <div className="flex flex-col space-y-2">
                <label htmlFor="type" className="font-medium">Team</label>
                <select name="type" value={type} className="rounded-md w-full border-2 border-gray-400"
                    onChange={(e) => setType(e.target.value)}>
                    {types.map(type => (
                        <option value={type}>{teamTypeLabel(type)}</option>
                    ))}
                </select>
            </div>

            <div className="flex flex-col space-y-2">
                <label htmlFor="type" className="font-medium">Members</label>
                <select name="type" value={quantity} className="rounded-md w-full border-2 border-gray-400"
                    onChange={(e) => setQuantity(e.target.value as any)}>
                    {Array(20).fill(1).map((_, index) => index + 1).map(n => (
                        <option key={`quantity-${n}`} value={n}>{n}</option>
                    ))}
                </select>
            </div>

            <div className="flex rounded-md bg-gitpod-kumquat-light p-3 mt-2">
                <img className="w-4 h-4 mx-2 my-auto" src={exclamation} />
                <span className="text-red-600">Total: {expectedPrice} per month</span>
            </div>

        </div>
        <div className="flex justify-end mt-6">
            <button className={"ml-2"} onClick={() => props.onBuy(getPlan(type), quantity)}>Continue to Billing</button>
        </div>
    </Modal>);
}